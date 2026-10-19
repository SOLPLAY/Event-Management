
from fastapi import APIRouter, HTTPException
from supabase import Client, create_client
from dotenv import load_dotenv
import os

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SECRET_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Supabase credentials are missing in .env")

supabase: Client = create_client(
    SUPABASE_URL,
    SUPABASE_KEY
)

router = APIRouter(
    prefix="/system-administrator",
    tags=["System Administrator"]
)


@router.get("/internal-people")
def get_internal_people():
    """Fetch non-deleted internal people."""

    try:
        response = (
            supabase
            .table("person")
            .select(
                "person_id, first_name, last_name, email_id, "
                "phone_number, gender, person_type, "
                "is_internal, department_id, address"
            )
            .eq("is_internal", True)
            .eq("is_delete",False)
            .execute()
        )

        return {
            "success": True,
            "count": len(response.data),
            "data": response.data
        }

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail=str(e)
        )
