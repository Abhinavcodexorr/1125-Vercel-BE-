from docx import Document
from docx.shared import Pt, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

BASE = 'http://localhost:3002/api/v1'


def set_cell_shading(cell, fill):
    shading = OxmlElement('w:shd')
    shading.set(qn('w:fill'), fill)
    cell._tc.get_or_add_tcPr().append(shading)


def add_title(doc, text):
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.bold = True
    run.font.size = Pt(22)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER


def add_api_heading(doc, num, name):
    p = doc.add_paragraph()
    run = p.add_run(f'{num}. {name}')
    run.bold = True
    run.font.size = Pt(14)
    doc.add_paragraph()


def add_field(doc, label, value):
    p = doc.add_paragraph()
    r1 = p.add_run(f'{label}: ')
    r1.bold = True
    p.add_run(value)


def add_request_table(doc, rows):
    doc.add_paragraph()
    p = doc.add_paragraph()
    r = p.add_run('Request:-')
    r.bold = True

    table = doc.add_table(rows=1, cols=4)
    table.style = 'Table Grid'
    headers = ['Parameter Name', 'Required/Optional', 'Data Type', 'Description']
    hdr = table.rows[0].cells
    for i, h in enumerate(headers):
        hdr[i].text = h
        for paragraph in hdr[i].paragraphs:
            for run in paragraph.runs:
                run.bold = True
        set_cell_shading(hdr[i], 'D9E2F3')

    for row in rows:
        cells = table.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = val
    doc.add_paragraph()


def add_response(doc, json_text):
    p = doc.add_paragraph()
    r = p.add_run('Response:-')
    r.bold = True
    code = doc.add_paragraph(json_text)
    code.style = 'No Spacing'
    for run in code.runs:
        run.font.name = 'Consolas'
        run.font.size = Pt(9)
    doc.add_paragraph()


def add_auth_note(doc, auth_type='Admin JWT'):
    add_field(doc, 'Auth', auth_type)
    add_field(doc, 'Header', 'x-access-token: <token>  OR  Authorization: Bearer <token>')


def build_doc():
    doc = Document()
    doc.add_paragraph()
    add_title(doc, 'API Documentation')
    doc.add_paragraph()
    add_field(doc, 'Project', '1125 Hotel / Palm Island Backend')
    add_field(doc, 'Base URL', BASE)
    add_field(doc, 'Version', 'v1')
    doc.add_paragraph()

    # Section header
    sec = doc.add_paragraph()
    sec_run = sec.add_run('ADMIN APIs')
    sec_run.bold = True
    sec_run.font.size = Pt(16)
    doc.add_paragraph()

    n = 1

    # 1. Admin Login
    add_api_heading(doc, n, 'Admin Login API')
    add_field(doc, 'Description', 'This API is used to login SuperAdmin, Manager, or SubAdmin and receive JWT token.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/login')
    add_field(doc, 'Method', 'POST')
    add_request_table(doc, [
        ['email', 'required', 'string', 'Admin email address'],
        ['password', 'required', 'string', 'Admin password'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "_id": "...",
      "name": "Admin",
      "email": "1125demo@gmail.com",
      "role": "SuperAdmin"
    }
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 2. Get Current Admin
    add_api_heading(doc, n, 'Get Current Admin API')
    add_field(doc, 'Description', 'This API returns the logged-in admin user profile.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/me')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['(none)', 'optional', '-', 'No body parameters. Send JWT in header.'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "User retrieved successfully",
  "data": {
    "_id": "...",
    "name": "Admin",
    "email": "1125demo@gmail.com",
    "role": "SuperAdmin"
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 3. Update Password
    add_api_heading(doc, n, 'Update Admin Password API')
    add_field(doc, 'Description', 'This API is used to change the logged-in admin password.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/password')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['oldPassword', 'required', 'string', 'Current password'],
        ['newPassword', 'required', 'string', 'New password'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Password updated successfully",
  "data": null,
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 4. Admin Logout
    add_api_heading(doc, n, 'Admin Logout API')
    add_field(doc, 'Description', 'This API logs out the current SuperAdmin session.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/logout')
    add_field(doc, 'Method', 'POST')
    add_auth_note(doc, 'SuperAdmin JWT')
    add_request_table(doc, [
        ['(none)', 'optional', '-', 'No body parameters.'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Logout successful",
  "data": null,
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 5. Create SubAdmin
    add_api_heading(doc, n, 'Create SubAdmin API')
    add_field(doc, 'Description', 'This API creates a new SubAdmin user. Only SuperAdmin can create.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/subadmin')
    add_field(doc, 'Method', 'POST')
    add_auth_note(doc, 'SuperAdmin JWT')
    add_request_table(doc, [
        ['name', 'required', 'string', 'SubAdmin full name'],
        ['email', 'required', 'string', 'SubAdmin email'],
        ['password', 'required', 'string', 'SubAdmin password'],
        ['role', 'optional', 'string', 'Default: SubAdmin'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 201,
  "message": "SubAdmin created successfully",
  "data": {
    "_id": "...",
    "name": "John Manager",
    "email": "manager@hotel.com",
    "role": "SubAdmin"
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 6. List SubAdmins
    add_api_heading(doc, n, 'List SubAdmins API')
    add_field(doc, 'Description', 'This API returns all SubAdmin / Manager users.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/subadmin')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['(none)', 'optional', '-', 'No query parameters.'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "SubAdmins retrieved successfully",
  "data": [
    {
      "_id": "...",
      "name": "John Manager",
      "email": "manager@hotel.com",
      "role": "SubAdmin",
      "isBlocked": false
    }
  ],
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 7. Get SubAdmin By ID
    add_api_heading(doc, n, 'Get SubAdmin By ID API')
    add_field(doc, 'Description', 'This API returns a single SubAdmin by ID.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/subadmin/:id')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'SubAdmin MongoDB _id'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "SubAdmin retrieved successfully",
  "data": {
    "_id": "...",
    "name": "John Manager",
    "email": "manager@hotel.com",
    "role": "SubAdmin"
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 8. Update SubAdmin
    add_api_heading(doc, n, 'Update SubAdmin API')
    add_field(doc, 'Description', 'This API updates SubAdmin details. SubAdmin cannot update others.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/subadmin/:id')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'SubAdmin MongoDB _id'],
        ['name', 'optional', 'string', 'Updated name'],
        ['email', 'optional', 'string', 'Updated email'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "SubAdmin updated successfully",
  "data": { "_id": "...", "name": "Updated Name", "email": "updated@hotel.com" },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 9. Block SubAdmin
    add_api_heading(doc, n, 'Block SubAdmin API')
    add_field(doc, 'Description', 'This API blocks a SubAdmin from logging in.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/subadmin/:id/block')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'SubAdmin MongoDB _id'],
        ['isBlocked', 'optional', 'boolean', 'Set true to block'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "SubAdmin blocked successfully",
  "data": { "_id": "...", "isBlocked": true },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 10. Unblock SubAdmin
    add_api_heading(doc, n, 'Unblock SubAdmin API')
    add_field(doc, 'Description', 'This API unblocks a SubAdmin so they can login again.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/subadmin/:id/unblock')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'SubAdmin MongoDB _id'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "SubAdmin unblocked successfully",
  "data": { "_id": "...", "isBlocked": false },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 11. Delete SubAdmin
    add_api_heading(doc, n, 'Delete SubAdmin API')
    add_field(doc, 'Description', 'This API permanently deletes a SubAdmin user.')
    add_field(doc, 'Endpoint', '/api/v1/superadmin/subadmin/:id')
    add_field(doc, 'Method', 'DELETE')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'SubAdmin MongoDB _id'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "SubAdmin deleted successfully",
  "data": null,
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # --- ROOMS ADMIN ---
    sec2 = doc.add_paragraph()
    sec2_run = sec2.add_run('ADMIN — ROOMS APIs')
    sec2_run.bold = True
    sec2_run.font.size = Pt(14)
    doc.add_paragraph()

    # 12. List Rooms Admin
    add_api_heading(doc, n, 'List All Rooms (Admin) API')
    add_field(doc, 'Description', 'This API returns all rooms including inactive. Excludes soft-deleted rooms.')
    add_field(doc, 'Endpoint', '/api/v1/rooms/admin')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['isActive', 'optional', 'string', 'Filter: true or false (query param)'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Rooms retrieved successfully",
  "data": {
    "total": 2,
    "data": [
      {
        "_id": "...",
        "title": "The Villa",
        "slug": "the-villa",
        "type": "Villa",
        "price": 500,
        "currency": "GHS",
        "guests": 5,
        "size": 850,
        "unit": "sq ft",
        "amenities": [],
        "images": [{ "url": "https://...", "order": 0 }],
        "blockedDates": [],
        "isActive": true,
        "isDeleted": false
      }
    ]
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 13. Get Room Admin
    add_api_heading(doc, n, 'Get Room By ID (Admin) API')
    add_field(doc, 'Description', 'This API returns a single room by MongoDB _id or slug.')
    add_field(doc, 'Endpoint', '/api/v1/rooms/admin/:idOrSlug')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['idOrSlug (path)', 'required', 'string', 'Room _id or slug e.g. the-villa'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Room retrieved successfully",
  "data": {
    "_id": "...",
    "title": "The Villa",
    "slug": "the-villa",
    "type": "Villa",
    "price": 500,
    "size": 850,
    "blockedDates": []
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 14. Create Room
    add_api_heading(doc, n, 'Create Room API')
    add_field(doc, 'Description', 'This API creates a new room/villa in the hotel catalog.')
    add_field(doc, 'Endpoint', '/api/v1/rooms')
    add_field(doc, 'Method', 'POST')
    add_auth_note(doc)
    add_request_table(doc, [
        ['title', 'required', 'string', 'Room name e.g. Presidential Villa'],
        ['type', 'required', 'string', 'Room type e.g. Villa, Suite'],
        ['price', 'required', 'number', 'Price per night'],
        ['guests', 'required', 'number', 'Max guests (min 1)'],
        ['size', 'required', 'number', 'Room size value'],
        ['slug', 'optional', 'string', 'URL slug (auto-generated from title if omitted)'],
        ['description', 'optional', 'string', 'Room description'],
        ['currency', 'optional', 'string', 'Default: GHS'],
        ['unit', 'optional', 'string', 'Size unit. Default: sq ft'],
        ['amenities', 'optional', 'array', '[{ name, icon, iconType, key }]'],
        ['images', 'optional', 'array', '[{ url, order }] — use upload API first'],
        ['isActive', 'optional', 'boolean', 'Default: true'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 201,
  "message": "Room created successfully",
  "data": {
    "_id": "...",
    "title": "Presidential Villa",
    "slug": "presidential-villa",
    "type": "Villa",
    "price": 500,
    "guests": 4,
    "size": 850,
    "unit": "sq ft",
    "images": [],
    "isActive": true
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 15. Update Room
    add_api_heading(doc, n, 'Update Room API')
    add_field(doc, 'Description', 'This API updates an existing room. Send only fields to change.')
    add_field(doc, 'Endpoint', '/api/v1/rooms/:idOrSlug')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['idOrSlug (path)', 'required', 'string', 'Room _id or slug'],
        ['title', 'optional', 'string', 'Updated title'],
        ['type', 'optional', 'string', 'Updated type'],
        ['price', 'optional', 'number', 'Updated price per night'],
        ['guests', 'optional', 'number', 'Updated max guests'],
        ['size', 'optional', 'number', 'Updated size'],
        ['description', 'optional', 'string', 'Updated description'],
        ['amenities', 'optional', 'array', 'Updated amenities list'],
        ['images', 'optional', 'array', 'Updated images list'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Room updated successfully",
  "data": { "_id": "...", "title": "Updated Villa", "price": 550 },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 16. Room Status
    add_api_heading(doc, n, 'Activate / Deactivate Room API')
    add_field(doc, 'Description', 'This API activates or deactivates a room on the website.')
    add_field(doc, 'Endpoint', '/api/v1/rooms/:idOrSlug/status')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['idOrSlug (path)', 'required', 'string', 'Room _id or slug'],
        ['isActive', 'required', 'boolean', 'true = show on website, false = hide'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Room activated successfully",
  "data": { "_id": "...", "isActive": true },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 17. Delete Room
    add_api_heading(doc, n, 'Delete Room API')
    add_field(doc, 'Description', 'This API soft-deletes a room. Room is hidden and marked isDeleted true.')
    add_field(doc, 'Endpoint', '/api/v1/rooms/:idOrSlug')
    add_field(doc, 'Method', 'DELETE')
    add_auth_note(doc)
    add_request_table(doc, [
        ['idOrSlug (path)', 'required', 'string', 'Room _id or slug'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Room deleted successfully",
  "data": { "_id": "...", "slug": "the-villa" },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 18. Upload Room Image
    add_api_heading(doc, n, 'Upload Room Image API')
    add_field(doc, 'Description', 'This API uploads one or more room images to AWS S3 bucket (rooms/ folder).')
    add_field(doc, 'Endpoint', '/api/v1/upload/room-image')
    add_field(doc, 'Method', 'POST')
    add_auth_note(doc)
    add_request_table(doc, [
        ['files', 'required', 'file (multipart)', 'Image file(s). Field name must be "files"'],
        ['order', 'optional', 'number', 'Starting display order. Default: 0'],
    ])
    add_field(doc, 'Content-Type', 'multipart/form-data')
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Room image(s) uploaded successfully",
  "data": {
    "total": 1,
    "images": [
      {
        "url": "https://palmisland.s3.eu-north-1.amazonaws.com/rooms/photo_123.png",
        "file_name": "photo_123.png",
        "order": 0
      }
    ]
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 19. Block Room Dates
    add_api_heading(doc, n, 'Block Room Dates API')
    add_field(doc, 'Description', 'This API blocks dates for a room so guests cannot book (maintenance, private events).')
    add_field(doc, 'Endpoint', '/api/v1/rooms/:idOrSlug/blocked-dates')
    add_field(doc, 'Method', 'POST')
    add_auth_note(doc)
    add_request_table(doc, [
        ['idOrSlug (path)', 'required', 'string', 'Room _id or slug'],
        ['startDate', 'required', 'string', 'Block start date YYYY-MM-DD (first blocked night)'],
        ['endDate', 'required', 'string', 'Block end date YYYY-MM-DD (checkout day, not blocked)'],
        ['reason', 'optional', 'string', 'Reason e.g. Maintenance'],
        ['blocks', 'optional', 'array', 'Multiple blocks: [{ startDate, endDate, reason }]'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Room dates blocked successfully",
  "data": {
    "room": { "_id": "...", "title": "The Villa", "slug": "the-villa" },
    "added": [
      {
        "startDate": "2026-07-01T00:00:00.000Z",
        "endDate": "2026-07-05T00:00:00.000Z",
        "reason": "Maintenance",
        "nights": 4
      }
    ],
    "blockedDates": ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 20. Get Blocked Dates
    add_api_heading(doc, n, 'Get Room Blocked Dates API')
    add_field(doc, 'Description', 'This API returns all admin-blocked date ranges for a room.')
    add_field(doc, 'Endpoint', '/api/v1/rooms/:idOrSlug/blocked-dates')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['idOrSlug (path)', 'required', 'string', 'Room _id or slug'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Blocked dates retrieved successfully",
  "data": {
    "room": { "_id": "...", "title": "The Villa", "slug": "the-villa" },
    "total": 1,
    "blocked": [
      {
        "_id": "...",
        "startDate": "2026-07-01T00:00:00.000Z",
        "endDate": "2026-07-05T00:00:00.000Z",
        "reason": "Maintenance",
        "occupiedDates": ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]
      }
    ],
    "blockedDates": ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"]
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 21. Unblock Room Dates
    add_api_heading(doc, n, 'Unblock Room Dates API')
    add_field(doc, 'Description', 'This API removes one blocked date range from a room.')
    add_field(doc, 'Endpoint', '/api/v1/rooms/:idOrSlug/blocked-dates/:blockId')
    add_field(doc, 'Method', 'DELETE')
    add_auth_note(doc)
    add_request_table(doc, [
        ['idOrSlug (path)', 'required', 'string', 'Room _id or slug'],
        ['blockId (path)', 'required', 'string', 'Blocked range _id from blockedDates array'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Room dates unblocked successfully",
  "data": {
    "removed": {
      "_id": "...",
      "startDate": "2026-07-01T00:00:00.000Z",
      "endDate": "2026-07-05T00:00:00.000Z",
      "reason": "Maintenance"
    },
    "blockedDates": []
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # --- BOOKING ADMIN ---
    sec3 = doc.add_paragraph()
    sec3_run = sec3.add_run('ADMIN — BOOKING APIs')
    sec3_run.bold = True
    sec3_run.font.size = Pt(14)
    doc.add_paragraph()

    # 22. List Bookings
    add_api_heading(doc, n, 'List All Bookings (Admin) API')
    add_field(doc, 'Description', 'This API returns all bookings for admin panel.')
    add_field(doc, 'Endpoint', '/api/v1/booking')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['filter', 'optional', 'string', 'Query: incomplete | paid | cancelled'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Bookings retrieved successfully",
  "data": [
    {
      "_id": "...",
      "bookingReference": "ABC12345",
      "checkInDate": "2026-06-05T00:00:00.000Z",
      "checkOutDate": "2026-06-08T00:00:00.000Z",
      "status": "Confirmed",
      "paymentStatus": "paid",
      "totalAmount": 1500
    }
  ],
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 23. Update Booking Status
    add_api_heading(doc, n, 'Update Booking Status API')
    add_field(doc, 'Description', 'This API updates booking status (Checked-In, Checked-Out, Cancelled, etc.).')
    add_field(doc, 'Endpoint', '/api/v1/booking/:id/status')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'Booking MongoDB _id'],
        ['status', 'required', 'string', 'Pending | Confirmed | Checked-In | Checked-Out | Cancelled | No-Show'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Booking status updated successfully",
  "data": { "_id": "...", "status": "Checked-In" },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 24. Manual Confirm Booking
    add_api_heading(doc, n, 'Manual Confirm Booking API')
    add_field(doc, 'Description', 'This API manually confirms a booking and marks payment as paid.')
    add_field(doc, 'Endpoint', '/api/v1/booking/:id/manual-confirm')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'Booking MongoDB _id'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Booking confirmed successfully",
  "data": { "_id": "...", "status": "Confirmed", "paymentStatus": "paid" },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 25. Cancel Booking
    add_api_heading(doc, n, 'Cancel Booking API')
    add_field(doc, 'Description', 'This API cancels a booking and sends cancellation email.')
    add_field(doc, 'Endpoint', '/api/v1/booking/:id/cancel')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'Booking MongoDB _id'],
        ['cancellationReason', 'optional', 'string', 'Reason for cancellation'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Booking cancelled successfully",
  "data": {
    "_id": "...",
    "status": "Cancelled",
    "cancellationReason": "Guest request",
    "cancelledAt": "2026-05-26T10:00:00.000Z"
  },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # --- PROMO ADMIN ---
    sec4 = doc.add_paragraph()
    sec4_run = sec4.add_run('ADMIN — PROMO CODE APIs')
    sec4_run.bold = True
    sec4_run.font.size = Pt(14)
    doc.add_paragraph()

    # 26. Create Promo
    add_api_heading(doc, n, 'Create Promo Code API')
    add_field(doc, 'Description', 'This API creates a new discount promo code.')
    add_field(doc, 'Endpoint', '/api/v1/promo')
    add_field(doc, 'Method', 'POST')
    add_auth_note(doc)
    add_request_table(doc, [
        ['code', 'required', 'string', 'Promo code e.g. SUMMER10'],
        ['discountType', 'required', 'string', 'percentage or flat'],
        ['discountValue', 'required', 'number', 'Discount amount or percentage'],
        ['startDate', 'optional', 'date', 'Promo valid from'],
        ['endDate', 'optional', 'date', 'Promo valid until'],
        ['isActive', 'optional', 'boolean', 'Default: true'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 201,
  "message": "Promo code created successfully",
  "data": { "_id": "...", "code": "SUMMER10", "discountValue": 10, "isActive": true },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 27. List Promo
    add_api_heading(doc, n, 'List Promo Codes API')
    add_field(doc, 'Description', 'This API returns all promo codes for admin.')
    add_field(doc, 'Endpoint', '/api/v1/promo/admin')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc)
    add_request_table(doc, [
        ['(none)', 'optional', '-', 'No parameters'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Promo codes retrieved successfully",
  "data": [{ "_id": "...", "code": "SUMMER10", "isActive": true }],
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 28. Update Promo
    add_api_heading(doc, n, 'Update Promo Code API')
    add_field(doc, 'Description', 'This API updates an existing promo code.')
    add_field(doc, 'Endpoint', '/api/v1/promo/:id')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'Promo MongoDB _id'],
        ['code', 'optional', 'string', 'Updated code'],
        ['discountValue', 'optional', 'number', 'Updated discount'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Promo code updated successfully",
  "data": { "_id": "...", "code": "SUMMER15" },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 29. Promo Status
    add_api_heading(doc, n, 'Activate / Deactivate Promo API')
    add_field(doc, 'Description', 'This API activates or deactivates a promo code.')
    add_field(doc, 'Endpoint', '/api/v1/promo/:id/status')
    add_field(doc, 'Method', 'PUT')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'Promo MongoDB _id'],
        ['isActive', 'required', 'boolean', 'true or false'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Promo code activated successfully",
  "data": { "_id": "...", "isActive": true },
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # 30. Delete Promo
    add_api_heading(doc, n, 'Delete Promo Code API')
    add_field(doc, 'Description', 'This API deletes a promo code.')
    add_field(doc, 'Endpoint', '/api/v1/promo/:id')
    add_field(doc, 'Method', 'DELETE')
    add_auth_note(doc)
    add_request_table(doc, [
        ['id (path)', 'required', 'string', 'Promo MongoDB _id'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Promo code deleted successfully",
  "data": null,
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')
    n += 1

    # --- CONTACT ADMIN ---
    sec5 = doc.add_paragraph()
    sec5_run = sec5.add_run('ADMIN — CONTACT APIs')
    sec5_run.bold = True
    sec5_run.font.size = Pt(14)
    doc.add_paragraph()

    # 31. List Contact Messages
    add_api_heading(doc, n, 'List Contact Messages API')
    add_field(doc, 'Description', 'This API returns all contact form messages submitted from website.')
    add_field(doc, 'Endpoint', '/api/v1/contact')
    add_field(doc, 'Method', 'GET')
    add_auth_note(doc, 'SuperAdmin JWT')
    add_request_table(doc, [
        ['(none)', 'optional', '-', 'No parameters'],
    ])
    add_response(doc, '''{
  "success": true,
  "statusCode": 200,
  "message": "Messages retrieved successfully",
  "data": [
    {
      "_id": "...",
      "name": "John Doe",
      "email": "john@email.com",
      "message": "I want to book a villa",
      "createdAt": "2026-05-26T10:00:00.000Z"
    }
  ],
  "timestamp": "2026-05-26T10:00:00.000Z"
}''')

    out = r'd:\1125 BE\1125 BE\docs\1125_API_Documentation_Admin.docx'
    doc.save(out)
    print(f'Saved: {out}')


if __name__ == '__main__':
    build_doc()
