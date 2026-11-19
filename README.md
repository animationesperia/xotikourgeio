# Ξωτικουργείο — Supabase + Render

## Setup
1. Run `02_admin_functions.sql` in Supabase SQL Editor AFTER the initial SQL already executed.
2. Upload `server.js`, `render.yaml`, `public/`, and this README to the ROOT of the GitHub repository (not inside a subfolder). Never upload secret values.
3. In Render create a Blueprint from this repository; fill the secret environment variables requested by the Blueprint (`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `PROMOTER_PASSWORD`). `SESSION_SECRET` is generated automatically. Verify the cost/plan is Free before approving.
4. After deployment test `/`, `/promoter`, `/admin` on separate devices. Do not print the public QR until verified.

## Important limits
- A static QR and refresh cannot be reliably distinguished. One ticket group per browser per Athens day is enforced by a signed HttpOnly cookie; clearing cookies, private mode, or switching browsers bypasses it. No identity or personal data is collected.
- A 60-minute expiry is applied when staff state is fetched or Next is pressed, not by a continuous background timer. Expired tickets are never reissued, and called tickets do not expire.
- The reset button clears today's tickets and resets to 001; use carefully.
- Public ticket page needs to stay open to show the visual alert. Browser sound/vibration are not guaranteed.
- Free Render may sleep after inactivity; verify wake-up latency and Supabase free project availability before the event.
- No built-in rate limiting or anti-bot protection. Do not distribute the QR until safeguards are reviewed for public event use.
- The original `issue_queue_numbers` SQL function is invoked via the service_role; do not expose this key to clients.
