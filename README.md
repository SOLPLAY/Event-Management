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
   `COUCHBASE_CONNECTION_STRING`, `COUCHBASE_USERNAME`, `COUCHBASE_PASSWORD`,
   `COUCHBASE_BUCKET`, `COUCHBASE_SCOPE` and `COUCHBASE_COLLECTION`.
3. From `Backend`, start the API with `uvicorn main:app --reload` (port 8000).
4. From `Frontend`, run `npm install` and `npm run dev`.

The login form accepts either the account username or numeric `login_id`. The
backend verifies the password against the `login` table; currently only the
System Administrator role has a configured destination (`/admin`). Existing
plaintext passwords are upgraded to salted PBKDF2 hashes after a successful
sign-in.

The system-administrator directory loads active departments from the
`department` table's `department_id` and `department_name` columns. The
directory role selection is stored as the person's `person_type`; it does not
create or change a login account. When a person is soft-deleted, adding the
same email again restores that record and updates its details and creation
audit fields.

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
