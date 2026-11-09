
from pydantic import BaseModel, Field
from typing import Optional
from fastapi import APIRouter, HTTPException
from supabase import Client, create_client
from dotenv import load_dotenv
from datetime import datetime
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


def current_audit_timestamp():
    now = datetime.now()
    return now.date().isoformat(), now.time().replace(microsecond=0).isoformat()


@router.get("/departments")
def get_departments():
    """Fetch departments for the person form."""

    try:
        response = (
            supabase
            .table("department")
            .select("department_id, department_name")
            .eq("is_delete", False)
            .order("department_name")
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
            detail="Failed to fetch departments"
        )


# Request model for creating an internal person
class InternalPersonCreate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email_id: str = Field(min_length=1, max_length=150)
    phone_number: str = Field(min_length=1, max_length=20)
    gender: str = Field(min_length=1, max_length=10)
    person_type: str = Field(min_length=1, max_length=50)
    department_id: Optional[int] = None
    address: str = Field(min_length=1, max_length=500)
    created_by: str = Field(min_length=1, max_length=250)
    

class InternalPersonUpdate(BaseModel):
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    email_id: str = Field(min_length=1, max_length=150)
    phone_number: str = Field(min_length=1, max_length=20)
    gender: str = Field(min_length=1, max_length=10)
    person_type: str = Field(min_length=1, max_length=50)
    department_id: Optional[int] = None
    address: str = Field(min_length=1, max_length=500)
    updated_by: str = Field(min_length=1, max_length=250)


# GET: View all active internal people
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
            .eq("is_delete", False)
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
            detail="Failed to fetch internal people"
        )


# POST: Create an internal person
@router.post("/internal-people", status_code=201)
def create_internal_person(person: InternalPersonCreate):
    """Create a new internal person."""

    try:
        # A soft-deleted person with this email can be restored in place.
        existing = (
            supabase
            .table("person")
            .select("person_id, is_delete")
            .eq("email_id", person.email_id)
            .limit(1)
            .execute()
        )

        if existing.data and not existing.data[0].get("is_delete"):
            raise HTTPException(
                status_code=409,
                detail="A person with this email already exists"
            )

        person_data = person.model_dump()
        person_data["is_internal"] = True
        person_data["is_delete"] = False
        created_date, created_time = current_audit_timestamp()
        person_data["created_date"] = created_date
        person_data["created_time"] = created_time

        if person.department_id is not None:
            department = (
                supabase
                .table("department")
                .select("department_id")
                .eq("department_id", person.department_id)
                .limit(1)
                .execute()
            )

            if not department.data:
                raise HTTPException(
                    status_code=400,
                    detail="Department ID does not exist"
                )

        if existing.data:
            person_id = existing.data[0]["person_id"]
            person_data["updated_by"] = person.created_by
            person_data["updated_date"] = created_date
            person_data["updated_time"] = created_time
            response = (
                supabase
                .table("person")
                .update(person_data)
                .eq("person_id", person_id)
                .eq("is_delete", True)
                .execute()
            )

            if not response.data:
                raise HTTPException(
                    status_code=409,
                    detail="Deleted person could not be restored; refresh and try again"
                )

            return {
                "success": True,
                "message": "Deleted person restored successfully",
                "data": response.data
            }

        response = (
            supabase
            .table("person")
            .insert(person_data)
            .execute()
        )

        return {
            "success": True,
            "message": "Internal person created successfully",
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to create internal person"
        )
        

@router.put("/internal-people/{person_id}")
def update_internal_person(
    person_id: int,
    person: InternalPersonUpdate
):
    """Update an existing internal person."""

    try:
        # Find the existing active internal person
        existing = (
            supabase
            .table("person")
            .select("person_id")
            .eq("person_id", person_id)
            .eq("is_internal", True)
            .eq("is_delete", False)
            .limit(1)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail="Internal person not found"
            )

        # Check whether the email belongs to another person
        duplicate_email = (
            supabase
            .table("person")
            .select("person_id")
            .eq("email_id", person.email_id)
            .neq("person_id", person_id)
            .limit(1)
            .execute()
        )

        if duplicate_email.data:
            raise HTTPException(
                status_code=409,
                detail="Email already belongs to another person"
            )

        # Validate the department if one is supplied
        if person.department_id is not None:
            department = (
                supabase
                .table("department")
                .select("department_id")
                .eq("department_id", person.department_id)
                .limit(1)
                .execute()
            )

            if not department.data:
                raise HTTPException(
                    status_code=400,
                    detail="Department ID does not exist"
                )

        # Prepare update fields
        update_data = person.model_dump()
        update_data.pop("updated_by", None)

        update_data["updated_by"] = person.updated_by

        updated_date, updated_time = current_audit_timestamp()
        update_data["updated_date"] = updated_date
        update_data["updated_time"] = updated_time

        # Update record in Supabase
        response = (
            supabase
            .table("person")
            .update(update_data)
            .eq("person_id", person_id)
            .eq("is_internal", True)
            .eq("is_delete", False)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=404,
                detail="Internal person was not updated"
            )

        return {
            "success": True,
            "message": "Internal person updated successfully",
            "data": response.data
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to update internal person"
        )



@router.delete("/internal-people/{person_id}")
def delete_internal_person(person_id: int):
    """Soft-delete an internal person."""

    try:
        # Check that the person exists and is active
        existing = (
            supabase
            .table("person")
            .select("person_id")
            .eq("person_id", person_id)
            .eq("is_internal", True)
            .eq("is_delete", False)
            .limit(1)
            .execute()
        )

        if not existing.data:
            raise HTTPException(
                status_code=404,
                detail="Active internal person not found"
            )

        # Update the deletion flag
        response = (
            supabase
            .table("person")
            .update({"is_delete": True})
            .eq("person_id", person_id)
            .eq("is_internal", True)
            .eq("is_delete", False)
            .execute()
        )

        if not response.data:
            raise HTTPException(
                status_code=404,
                detail="Internal person could not be deleted"
            )

        return {
            "success": True,
            "message": "Internal person deleted successfully",
            "person_id": person_id
        }

    except HTTPException:
        raise

    except Exception as e:
        print("Supabase error:", repr(e))
        raise HTTPException(
            status_code=500,
            detail="Failed to delete internal person"
        )
