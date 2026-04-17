import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, create_engine

# 讓 alembic 能 import 到 main_service 的 models
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from models.patient import Base

# Alembic Config
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# SQLAlchemy MetaData（autogenerate 用）
target_metadata = Base.metadata

# 從環境變數讀取 DB URL（把 asyncpg 換成 psycopg2 給 alembic 用）
def get_url():
    url = os.getenv(
        "APP_DATABASE_URL",
        "postgresql+asyncpg://postgres:dev@localhost:5432/app_db",
    )
    # alembic 需要同步 driver，把 asyncpg 換成 psycopg2
    return url.replace("+asyncpg", "")


def run_migrations_offline():
    """Run migrations in 'offline' mode — 產生 SQL script 而非直接連 DB。"""
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode — 直接連 DB 執行。"""
    connectable = create_engine(get_url(), poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
