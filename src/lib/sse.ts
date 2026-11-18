import ky, {
  type AfterResponseHook,
  type KyResponse,
  type NormalizedOptions,
} from 'ky';
import { createParser, type EventSourceParser } from 'eventsource-parser';

export interface SSEOptions {
  onData: (data: string) => void;
  onCompleted?: (error?: Error) => void;
  onAborted?: () => void;
}

/** ky afterResponse 钩子：解析 SSE 流并逐帧回调 */
export function createSSEHook(options: SSEOptions): AfterResponseHook {
  const hook: AfterResponseHook = async (
    request: Request,
    _options: NormalizedOptions,
    response: KyResponse
  ) => {
    if (!response.ok || !response.body) {
      /* 非 ok 响应必须上报错误，否则上层拿到空文本形成空白气泡 */
      let detail = `HTTP ${response.status}`;
      try {
        const text = await response.text();
        if (text) detail += ` ${text.slice(0, 200)}`;
      } catch {
        /* 读取失败时保留状态码 */
      }
      options.onCompleted?.(new Error(`AI 服务响应异常（${detail}）`));
      return response;
    }

    let completed = false;
    const finish = (error?: Error): void => {
      if (completed) return;
      completed = true;
      options.onCompleted?.(error);
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf8');
    const parser: EventSourceParser = createParser({
      onEvent: (event) => {
        if (!event.data) return;
        for (const chunk of event.data.split('\n')) {
          options.onData(chunk);
        }
      },
    });

    const read = (): void => {
      reader
        .read()
        .then((result) => {
          if (result.done) {
            finish();
            return;
          }
          parser.feed(decoder.decode(result.value, { stream: true }));
          read();
        })
        .catch((error) => {
          if (request.signal.aborted) {
            options.onAborted?.();
            return;
          }
          finish(error as Error);
        });
    };

    read();
    return response;
  };

  return hook;
}

export interface StreamRequestOptions {
  functionUrl: string;
  requestBody: unknown;
  authToken: string | null;
  onData: (data: string) => void;
  onComplete: () => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

/** 向后端 AI 接口发送流式请求（SSE） */
export async function sendStreamRequest(options: StreamRequestOptions): Promise<void> {
  const { functionUrl, requestBody, authToken, onData, onComplete, onError, signal } = options;

  /* 等待流真正读完再 resolve：ky.post 在响应头到达即返回，
     若不包装 Promise，调用方会在流式内容接收完成前拿到空文本 */
  return new Promise<void>((resolve, reject) => {
    const sseHook = createSSEHook({
      onData,
      onCompleted: (error?: Error) => {
        if (error) {
          onError?.(error);
          reject(error);
        } else {
          onComplete();
          resolve();
        }
      },
      onAborted: () => {
        /* 主动中断按完成处理，不视为错误 */
        onComplete();
        resolve();
      },
    });

    ky
      .post(functionUrl, {
        json: requestBody,
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          'Content-Type': 'application/json',
        },
        signal,
        hooks: { afterResponse: [sseHook] },
      })
      .catch((error: unknown) => {
        if (signal?.aborted) resolve();
        else {
          onError?.(error as Error);
          reject(error as Error);
        }
      });
  });
}
