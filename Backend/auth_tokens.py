from datetime import datetime, timedelta, timezone
import os

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from dotenv import load_dotenv

load_dotenv()

AUTH_TOKEN_SECRET = os.getenv("AUTH_TOKEN_SECRET") or os.getenv("SUPABASE_SECRET_KEY")
if not AUTH_TOKEN_SECRET:
    raise RuntimeError("AUTH_TOKEN_SECRET or SUPABASE_SECRET_KEY is missing in .env")

bearer_scheme = HTTPBearer(auto_error=False)


class AuthenticatedUser(BaseModel):
    person_id: int
    username: str
    role: str


def create_access_token(person_id: int, username: str, role: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=8)
    return jwt.encode(
        {
            "person_id": person_id,
            "username": username,
            "role": role,
            "exp": expires_at,
        },
        AUTH_TOKEN_SECRET,
        algorithm="HS256",
    )


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication is required")

    try:
        claims = jwt.decode(
            credentials.credentials,
            AUTH_TOKEN_SECRET,
            algorithms=["HS256"],
        )
        return AuthenticatedUser(
            person_id=int(claims["person_id"]),
            username=claims["username"],
            role=claims["role"],
        )
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from error
