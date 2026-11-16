# NITT Event Management System

A modern web-based **Event Management System** developed as part of the **Next Gen Database (NGDB)** project.

The system is designed to simplify the process of creating, managing, discovering, and registering for college events through a centralized platform.

---

## 📌 About the Project

Managing college events often involves multiple processes such as event creation, registrations, venue management, participant tracking, and communication.

The **NITT Event Management System** brings these activities together into a single platform.

The system provides separate interfaces for **Administrators** and **Users**, allowing each role to access the features relevant to them.

---

## ✨ Key Features

### 👨‍💼 Admin

- Create new events
- Edit and delete events
- View event details
- Manage departments and venues
- Monitor event registrations
- View event reports
- Manage event-related information

### 👨‍🎓 User

- Browse available events
- View complete event details
- Register for events
- View registered events
- Receive event notifications
- Access events through a responsive interface

---

## 🌟 Highlights

### 🔔 Event Notifications

When an administrator creates a new event, active users can receive a notification on their dashboard, helping them stay updated about newly added events.

### 📱 Responsive Design

The application is designed to provide a consistent and user-friendly experience across desktops, laptops, tablets, and mobile devices.

### 📊 Event Management & Reports

Administrators can manage events from a centralized dashboard and access relevant event and registration information.

---

## 🛠️ Technologies Used

- **Frontend:** React
- **Backend:** Python
- **Database:** Supabase
- **Version Control:** Git & GitHub

Additional database technologies may be explored as the project develops.

## Running the application

1. From `Backend`, install dependencies with `py -m pip install -r requirements.txt`.
2. Configure `Backend/.env` with `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `COUCHBASE_CONNECTION_STRING`,
   `COUCHBASE_USERNAME`, `COUCHBASE_PASSWORD`, `COUCHBASE_BUCKET`,
   `COUCHBASE_SCOPE` and `COUCHBASE_COLLECTION`.
3. From `Backend`, start the API with `uvicorn main:app --reload` (port 8000).
4. From `Frontend`, run `npm install` and `npm run dev`.

Before using accommodation requests, run
`Documentation/accommodation_schema.sql` in the Supabase SQL Editor. Add one
`room` row per room with its building, room number, bed capacity, and active
state. If existing accommodation assignments predate the `room_id` column,
rerun the legacy room-linking update in that SQL file after adding those rooms.
Keep `SUPABASE_SERVICE_ROLE_KEY` only in the backend environment; it is used for
server-side room inventory reads and the accommodation approval function.

Before marking session attendance, run
`Documentation/session_attendance_schema.sql` in the Supabase SQL Editor.
Attendance is stored per session and registration; organizers can mark each
registered student present or absent from the session schedule.

Event organizers can add, edit, and remove hospitality plans from each event's
Hospitality tab. Removed plans are soft-deleted and no additional schema change
is required.

The Event report tab summarizes active registrations and verified payment
submission amounts, registration `fee_paid` totals, session attendance marks,
unique students marked present, distinct session speakers, sponsors by level,
evaluations and score/rating distributions, and active hospitality plans.
Attendance charts count marks per session; the headline present-student count
counts each registered student once if marked present in at least one session.

Before using advertisement and sponsor management, run
`Documentation/advertisement_sponsors_media.sql` in the Supabase SQL Editor.
This adds sponsor records, advertisement media metadata, and a private
`event-advertisements` Storage bucket. Organizers can manage sponsor details and
advertisement schedules from the Advertisement tab, and upload JPEG, PNG, WebP,
GIF, MP4, WebM, or MOV media (up to 50 MB). Files are stored in Supabase Storage;
only their paths and metadata are stored in Postgres. Keep
`SUPABASE_SERVICE_ROLE_KEY` only in `Backend/.env`; the backend uses it for
private sponsor access and media upload, deletion, and signed viewing links.

The login form accepts either the account username or numeric `login_id`. The
backend verifies the password against the `login` table; currently only the
System Administrator, Super Admin, and Event Organizer roles have configured
destinations. Existing plaintext passwords are upgraded to salted PBKDF2 hashes
after a successful sign-in.

The system-administrator directory loads active departments from the
`department` table's `department_id` and `department_name` columns. The
directory role selection is stored as the person's `person_type`; it does not
create or change a login account. When a person is soft-deleted, adding the
same email again restores that record and updates its details and creation
audit fields.

Event organizers can create events for Super Admin approval, edit pending
events, edit and resubmit rejected events, and publish approved events. Approved
events cannot be edited. Event categories are selected from Hackathon, Seminar,
Workshop, Competition, and Symposium; descriptions are stored in
`event_type.description`. Organizers set a non-negative registration fee in
rupees when submitting or editing an event; enter `0` for a free event. Super Admins can
review all events and approve or reject pending requests. Organizer event lists
are scoped to the authenticated user's `person_id` through `event_organizer`.
Published events become completed after their end date; published and
completed events cannot be edited or deleted. Event type is saved in both
`event.type` and `event_type.category`.

Super Admin event endpoints are defined in `Backend/super_admin/super_admin.py`,
and Event Organizer endpoints are defined in
`Backend/event_organizer/event_organizer.py`. Shared event models and helpers
remain in `Backend/event_management.py`.

The event-management API uses an eight-hour signed bearer token. Set
`AUTH_TOKEN_SECRET` in `Backend/.env` to a private signing secret; if omitted,
the backend uses `SUPABASE_SECRET_KEY`.

---

## 🎯 Project Objectives

- Create a centralized platform for college event management.
- Simplify event registration for students.
- Make event management easier for administrators.
- Improve communication between event organizers and participants.
- Provide a responsive and user-friendly experience.
- Explore modern database technologies through a practical application.

---

## 👥 Project Team

**Project:** Next Gen Database (NGDB)

**Project Title:** NITT Event Management System

### Team Members

- Shubham Savani . 🔗 [LinkedIn](https://www.linkedin.com/in/theshubhamsavani) ✉️ [Email](mailto:shubhamsavani5122000@gmail.com)
- Manan Patel
- Aryan Kapadiya


---

## 📚 Academic Project

This project is developed as part of the **Next Gen Database (NGDB)** course/project.

The project focuses on applying database concepts and modern web technologies to solve a practical problem in college event management.

---

## 🚀 Project Status

**Currently under development**

The system will continue to evolve with additional features, improvements, and database integrations.

---

### Made with ❤️ by the NGDB Team

**NITT Event Management System**  
*Making college events simpler, smarter, and more accessible.*
