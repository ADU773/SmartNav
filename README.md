# SmartNav Development Logbook

| Date | New Methodology / Work Found |
|---|---|
| 2026-09-21 | **AI-Assisted Floor Plan Rendering:** Introduced Puter.js with Gemini-based image generation to convert uploaded 2D floor plans into photorealistic top-down architectural renders while preserving walls, rooms, doors, and windows. |
| 2026-09-21 | **QR-Based Panorama Capture:** Introduced a QR-code workflow that allows a smartphone to connect to a desktop panorama session and capture images directly from the phone. |
| 2026-09-21 | **Live Mobile-to-Desktop Synchronization:** Added panorama sessions that allow photographs captured on the mobile device to appear on the desktop interface through periodic session polling. |
| 2026-09-21 | **Computer-Vision Panorama Stitching:** Introduced browser-based OpenCV.js stitching using ORB feature detection, BFMatcher, Lowe's ratio test, RANSAC homography estimation, and perspective warping. |
| 2026-09-21 | **Feature-Based Image Alignment:** Replaced simple image concatenation with feature matching and homography-based alignment so overlapping photographs can be combined into a panorama. |
| 2026-09-21 | **Panorama Asset Integration:** The generated panorama is converted into a JPEG file and uploaded through the existing SmartNav asset-management pipeline. |
| 2026-09-21 | **Panorama Session Management:** Added a dedicated PanoramaSession model with unique session tokens, open/done states, uploaded-photo references, expiration time, and MongoDB TTL cleanup. |
| 2026-09-21 | **Mobile Camera Capture:** Added a dedicated mobile capture route using the browser camera interface, allowing multiple overlapping photographs to be captured and uploaded sequentially. |
| 2026-09-21 | **Graph-Based Navigation:** Scene connections are treated as a graph where scenes act as nodes and hotspots act as edges, enabling route-based navigation through the virtual mall. |
| 2026-09-21 | **Turn-by-Turn Panorama Navigation:** Added route guidance and hotspot highlighting to provide structured navigation between panoramic scenes. |
| 2026-09-21 | **Large-File Upload Support:** Increased the backend upload limit to support files up to 500 MB, which is useful for high-resolution visual and panoramic assets. |
| 2026-09-21 | **Backend Data Integrity:** Strengthened project, scene, asset, hotspot, and analytics relationships using validation and MongoDB transactions. |
| 2026-09-21 | **Safe File Cleanup:** Introduced pending file deletion and retry mechanisms so filesystem cleanup can recover from temporary deletion failures. |
| 2026-09-21 | **Cross-Project Validation:** Added validation to prevent scenes, assets, and hotspot relationships from referencing resources belonging to different projects. |
| 2026-09-21 | **UI Redesign:** Redesigned the dashboard and major SmartNav workspaces using React and Ant Design, including reusable interface components and the SmartNav logo component. |
| 2026-09-21 | **User Accounts and Authentication:** Replaced the placeholder login (which accepted any email and password) with real accounts: bcrypt password hashing, short-lived JWT access tokens, and rotating refresh tokens stored as SHA-256 hashes. Reusing an already-rotated refresh token is treated as theft and signs out that user's whole token family. |
| 2026-09-21 | **Per-User Projects (Multi-Tenancy):** Every project now has an owner, and every read and write is scoped to it inside the same atomic database operation. Another account's project is reported as "not found" rather than "forbidden", so its existence is never revealed. Published share links remain the one read-only public route. |
| 2026-09-21 | **API Hardening:** CORS restricted to an allowlist, security headers (helmet), rate limits for sign-in, uploads, capture sessions and the API as a whole, boot-time environment validation (zod), a `/healthz` readiness endpoint, structured request logging with request IDs (pino), and graceful shutdown. |
| 2026-09-21 | **Database Indexes and Pagination:** Added compound indexes for the owner's project list and each project's scenes and assets, which were previously full collection scans, and paginated every list endpoint. |
| 2026-09-21 | **Image Thumbnail Pipeline:** Each upload records its dimensions and gets a small WebP thumbnail (sharp), so pickers and grids load kilobytes instead of multi-megabyte panoramas. Measured: a 1.28 MB panorama produced a 1.4 KB thumbnail. Images with a 2:1 aspect ratio are flagged as 360° panoramas. |
| 2026-09-21 | **Live Session Updates (Server-Sent Events):** Replaced the desktop's 2.5-second polling of capture sessions with a server-sent event stream, so phone photos appear as soon as they are uploaded. |
| 2026-09-21 | **Accessibility-Aware Routing:** Every connection records how it is walked (flat, door, ramp, elevator, escalator, stairs). The route finder weights each mode and can exclude modes entirely, so a step-free route genuinely avoids stairs rather than merely preferring not to use them. |
| 2026-09-21 | **Visitor Analytics:** Added average time spent in each scene, the most-walked connections between scenes, and a daily activity timeline. |
| 2026-09-21 | **Automated Testing and CI:** Added a backend security and integrity test suite, a frontend test suite (Vitest), and a GitHub Actions workflow that runs tests, lint and build on every push. |
| 2026-09-24 | **SmartNav Capture Mobile App:** A dedicated Expo / React Native app scans the session QR code and guides the capture: gravity-based tilt, gyroscope-based heading, a horizon and framing overlay, automatic capture as the phone turns, and a capture plan calculated from the camera's real field of view to target about 45% overlap between frames. Each photo is uploaded with its heading, tilt and roll, and uploads can be retried without creating duplicates. |
| 2026-09-24 | **Sensor-Assisted Equirectangular Stitching:** Rebuilt desktop stitching around a rotation-only camera model. The phone's sensors provide the starting estimate, overlapping image content decides the final placement, one shared focal length is solved from the matched points, and any leftover error is spread evenly around the full turn (loop closure). The result is a true 360° equirectangular image. |
| 2026-09-26 | **Learned Feature Matching (XFeat):** Replaced ORB as the primary matcher with XFeat, a small neural keypoint model (CVPR 2024), running in the browser through ONNX Runtime Web. ORB is kept as a fallback for any pair XFeat cannot align. Measured on a real 13-photo indoor capture: 2.3–3.3× more verified matching points than ORB, with the two methods agreeing on frame rotation to within 0.7°. |
| 2026-09-26 | **Automatic Cleanup After Stitching:** Once a stitched panorama is saved, the individual photos used to build it are removed, so each capture leaves one asset instead of a dozen. This only runs after the panorama has uploaded successfully, and any photo already used by a scene or as the floor plan is kept. |
| 2026-09-26 | **Redesigned Hotspot Builder:** A three-step guide (pick a scene, click the doorway, choose where it leads); a visible pin where you clicked; choosing the destination by picture; an option to create the way back automatically, facing the opposite direction; an editor for existing connections (label, access type, distance, move, delete); link counts per scene; and a warning listing scenes visitors cannot reach. |
| 2026-09-26 | **Image Previews When Selecting:** Creating a scene, choosing a hotspot destination and choosing a floor plan now show thumbnails and a large preview instead of a list of file names. |
| 2026-09-26 | **"Where Am I?" Visual Place Recognition:** A visitor photographs their surroundings and the system identifies which scene they are in and which way they are facing, then turns the 360° view to match and uses it as the route's starting point. Each panorama is indexed as a ring of 24 camera-like views, embedded with the DINOv2 image model on the server. Measured on real photos: 13 of 13 correctly located, with headings within about 6.5°; a photo from a room that was never mapped is reported as "not sure" rather than as a confident wrong answer. |

## Main Methodologies Introduced

| Methodology | Technology / Algorithm |
|---|---|
| AI Floor Plan Rendering | Puter.js + Gemini image generation |
| Panorama Capture | QR Code + Smartphone Camera |
| Image Feature Detection | ORB |
| Feature Matching | BFMatcher + Hamming Distance |
| Match Filtering | Lowe's Ratio Test |
| Image Alignment | RANSAC Homography |
| Perspective Correction | `warpPerspective` |
| Panorama Processing | OpenCV.js |
| Virtual Panorama Viewing | Marzipano |
| Navigation | Scene Graph + Hotspots |
| Route Guidance | Graph-based path traversal |
| Data Management | MongoDB + Mongoose |
| API Backend | Node.js + Express.js |
| File Uploads | Multer |
| UI | React + Ant Design |
| Authentication | JWT access tokens + rotating refresh tokens, bcrypt |
| Authorisation | Owner-scoped queries inside MongoDB transactions |
| API Security | helmet, CORS allowlist, express-rate-limit, zod |
| Logging | pino with per-request IDs |
| Image Pipeline | sharp (dimensions + WebP thumbnails) |
| Live Updates | Server-sent events |
| Accessible Routing | Weighted Dijkstra with excludable access modes |
| Mobile Capture App | Expo / React Native, device gravity + gyroscope |
| 360° Stitching | Rotation-only camera model, focal-length solve, loop closure |
| Learned Feature Matching | XFeat (ONNX Runtime Web), ORB fallback |
| Visual Place Recognition | DINOv2-small (ONNX Runtime, Node.js) + cosine similarity |
| Testing | node:test, Vitest, MongoDB Memory Server |
| Continuous Integration | GitHub Actions |

## Running SmartNav360

### One-click demo (Windows)

Double-click **start-demo.bat** in the project folder. It checks Node.js and `backend/.env`, installs any missing packages, downloads the "Where am I?" model, starts the backend and frontend in their own windows, waits until both respond, and opens the app at this computer's network address so a phone on the same Wi-Fi can scan the capture QR code. It finishes by printing a suggested demo order.

| Command | What it does |
|---|---|
| `start-demo.bat` | Start everything and open the app |
| `start-demo.bat check` | Check the setup without starting anything (run this before the demo) |
| `start-demo.bat test` | Run the backend and frontend test suites first, then start |
| `start-demo.bat mobile` | Also start the SmartNav Capture phone app (Expo) |
| `stop-demo.bat` | Stop the servers and close their windows |

If a phone cannot connect, make sure it is on the same Wi-Fi and that Windows Firewall allows Node.js on Private networks.

The sections below are the same steps done by hand.

### Backend

```bash
cd backend
npm install
cp .env.example .env        # then fill in MONGODB_URI and the two JWT secrets
npm run models:fetch        # one-time download of the "Where am I?" model (24 MB, checksum-verified)
npm start                   # http://localhost:5000
```

The MongoDB database must be a replica set (MongoDB Atlas works), because writes use transactions. In production the server refuses to start with the development JWT secrets.

### Frontend

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

To capture panoramas from a phone on the same Wi-Fi, run `npm run dev -- --host` and open the desktop app at your computer's network address (for example `http://192.168.1.5:5173`) rather than `localhost`, so the QR code points somewhere the phone can reach.

### First sign-in and existing projects

Create an account at `/register`; the first account becomes the administrator. Projects created before accounts existed have no owner and stay hidden until they are assigned to an account:

```bash
npm --prefix backend run migrate:owners -- --email you@example.com --dry-run   # preview
npm --prefix backend run migrate:owners -- --email you@example.com             # apply
```

### Tests

```bash
npm --prefix backend test
npm --prefix frontend test
```
