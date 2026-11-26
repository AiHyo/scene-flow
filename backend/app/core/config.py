from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# 优先读取仓库根目录 .env，其次读取 backend/.env
_ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
_LOCAL_ENV = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=[str(_ROOT_ENV), str(_LOCAL_ENV)],
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # 数据库
    database_url: str = "postgresql+asyncpg://sceneflow:sceneflow_dev@127.0.0.1:5432/sceneflow"

    # MinIO / S3 对象存储
    minio_endpoint: str = "http://127.0.0.1:9000"
    minio_public_url: str = "http://127.0.0.1:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin123"
    minio_bucket: str = "media"

    # JWT 鉴权
    jwt_secret: str = "sceneflow-dev-jwt-secret-change-in-prod-32b"
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


settings = Settings()
