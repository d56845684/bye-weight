import json
import os
from functools import wraps

import redis.asyncio as aioredis
from fastapi.encoders import jsonable_encoder

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6380/0")
redis_client = aioredis.from_url(REDIS_URL)


def cache(key_fn, ttl: int = 300):
    """API 回應快取裝飾器（fix #7: 使用 jsonable_encoder 處理 Decimal/datetime/Pydantic）"""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            key = key_fn(*args, **kwargs)
            cached = await redis_client.get(key)
            if cached:
                return json.loads(cached)
            result = await func(*args, **kwargs)
            serializable = jsonable_encoder(result)
            await redis_client.setex(key, ttl, json.dumps(serializable))
            return result

        return wrapper

    return decorator


async def invalidate(key: str):
    await redis_client.delete(key)
