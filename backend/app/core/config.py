from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# 优先读取仓库根目录 .env，其次读取 backend/.env
_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
_LOCAL_ENV = Path(__file__).resolve().parents[2] / ".env"

DEV_JWT_SECRET = "sceneflow-dev-jwt-secret-change-in-prod-32b"
# 仓库中出现过的示例值，生产环境一律视为未配置
_KNOWN_WEAK_SECRETS = {DEV_JWT_SECRET, "change-me-in-production", "changeme", "secret"}
MIN_PROD_SECRET_LENGTH = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(_ROOT_ENV), str(_LOCAL_ENV)],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 运行环境：dev 允许内置默认密钥以便 clone 即跑；prod 强制安全配置
    app_env: Literal["dev", "prod"] = "dev"
    log_level: str = "INFO"

    # 允许跨域的前端来源（逗号分隔）。Docker 部署经 Nginx 同源访问，仅本地开发需要
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:8080,http://localhost:8080"

    # 数据库
    database_url: str = "postgresql+asyncpg://sceneflow:sceneflow_dev@127.0.0.1:5432/sceneflow"

    # MinIO / S3 对象存储
    minio_endpoint: str = "http://127.0.0.1:9000"
    minio_public_url: str = "http://127.0.0.1:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin123"
    minio_bucket: str = "media"

    # 样例场地底图来源目录：启动时幂等预置到对象存储 samples/（Docker 中经只读挂载提供）
    sample_assets_dir: str = str(Path(__file__).resolve().parents[3] / "public" / "images" / "layout-reference")

    # JWT 鉴权
    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080

    # AI 对话（OpenAI 兼容协议）
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"
    llm_vision_model: str = "gpt-4o-mini"

    # 图像理解（未单独配置时复用 LLM 视觉模型）
    vision_base_url: str = ""
    vision_api_key: str = ""
    vision_model: str = ""

    # 场景生图
    img_gen_provider: str = "openai"
    img_gen_base_url: str = ""
    img_gen_api_key: str = ""
    img_gen_model: str = "gpt-image-2.6"

    # AI 调用限流（每小时次数；访客更严格）
    quota_chat_guest_per_hour: int = 30
    quota_chat_account_per_hour: int = 120
    quota_vision_guest_per_hour: int = 10
    quota_vision_account_per_hour: int = 40
    quota_scene_guest_per_hour: int = 5
    quota_scene_account_per_hour: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @model_validator(mode="after")
    def _require_strong_secret_in_prod(self) -> Settings:
        if self.app_env == "prod":
            secret = self.jwt_secret.strip()
            if secret in _KNOWN_WEAK_SECRETS or len(secret) < MIN_PROD_SECRET_LENGTH:
                raise ValueError(
                    f"APP_ENV=prod 时必须设置 JWT_SECRET 为至少 {MIN_PROD_SECRET_LENGTH} 位的随机字符串，"
                    "不能使用仓库中的示例值"
                )
        return self


settings = Settings()
