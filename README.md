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
| 2026-09-26 | **Object Detection with Directions (YOLOX-S):** Object detection now runs on the SmartNav server itself instead of needing a separate YOLO service. Each panorama is split into 12 camera-like views (8 around the horizon and 4 looking down at desks and the floor), YOLOX-S finds the objects in each view, and each object is recorded with the direction it sits in. Sightings from overlapping views are compared on a shared image plane, over only the region both views could see, so an object seen twice, cut off at a view's edge, or lying under the camera is counted once, while people sitting side by side stay separate. On simulated rooms, a single object is counted twice at 0.3% of positions, and rows of chairs and of people are counted exactly in 99–100% of layouts. The scene page lists the objects found ("laptop ×7"), and clicking one turns the 360° view to face it, cycling through each instance. Object names are added to the scene's tags and given to the AI assistant. Scans run one at a time, are rate-limited, and are saved only if the scene's panorama did not change during the scan. On Windows the detector runs on the GPU through DirectML when that is faster: each machine's CPU and graphics adapters are timed once and the fastest is remembered (set `ONNX_DEVICE` to override). Measured on a real classroom panorama: about 1 second per scan on an RTX 3050 laptop GPU against 2 seconds on the CPU, with identical results and each object's recorded direction landing on the object. |
| 2026-09-29 | **GPU Feature Matching (SuperPoint + LightGlue):** Panorama frames are now matched on the server's GPU by SuperPoint + LightGlue, a stronger learned matcher than XFeat for low-overlap and low-texture pairs. The browser uploads its working-resolution frames for the request only (nothing is stored), gets the correspondences back, and runs the same rotation-only registration, focal-length solve and loop closure on them. XFeat and ORB stay as per-pair fallbacks, so stitching still works when the server has no GPU, the model is missing, or the user is signed out. Checked against ground truth: views rendered 30° apart from a real panorama were recovered at 30.00°, at about 190 ms per pair on an RTX 3050 laptop GPU (DirectML), against about 700 ms on the CPU. |

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
| Learned Feature Matching | SuperPoint + LightGlue (ONNX Runtime, Node.js, DirectML GPU when available), XFeat (ONNX Runtime Web) and ORB fallbacks |
| Visual Place Recognition | DINOv2-small (ONNX Runtime, Node.js) + cosine similarity |
| Object Detection | YOLOX-S (ONNX Runtime, Node.js, DirectML GPU when available), 12 views per panorama, cross-view merging on a shared image plane |
| Testing | node:test, Vitest, MongoDB Memory Server |
| Continuous Integration | GitHub Actions |

## Setting Up on a New Computer

These steps take a computer with nothing installed to a running SmartNav360. On Windows, steps 5–7 are done for you by `start-demo.bat`.

### 1. Install the tools

| Tool | Needed for | Notes |
|---|---|---|
| [Node.js](https://nodejs.org) 20 or newer (LTS) | Everything | Includes `npm`. Tested with Node.js 24. |
| [Git](https://git-scm.com) | Getting the code | Not needed if you copy the folder instead. |
| [MongoDB Community Server](https://www.mongodb.com/try/download/community) | Only if you do not use MongoDB Atlas | See step 3. |
| [Expo Go](https://expo.dev/go) on a phone | Only for the SmartNav Capture phone app | Optional. |

Nothing extra is needed for the GPU. On Windows 10/11 with a DirectX 12 graphics card, object detection uses the GPU through DirectML, which is included with the backend's packages. On macOS and Linux it runs on the CPU.

### 2. Get the code

```bash
git clone https://github.com/ADU773/SmartNav.git SmartNav360
cd SmartNav360
```

Or copy the project folder from another computer. You can leave out every `node_modules` folder and `backend/.cache`, because they are rebuilt.

Two things are not in Git and must be copied by hand if you want them:

- `backend/uploads/` holds every uploaded image and panorama. Without it, scenes stored in an existing database show broken images. A fresh database does not need it.
- `backend/.env` holds the database address and secrets (step 4). Pass it privately, never through Git or chat.

### 3. Choose a database

The backend needs a MongoDB **replica set**, because its writes use transactions. Pick one option.

**MongoDB Atlas (easiest, and the one the project uses).** Use the existing cluster's connection string, or create a free cluster. In Atlas, open **Network Access** and add this computer's IP address. A new computer or a new Wi-Fi network is the most common reason the backend cannot connect.

**Local MongoDB.** A standalone server is not enough; start it as a one-node replica set:

```bash
mkdir C:\data\rs0                                   # macOS/Linux: mkdir -p ~/data/rs0
mongod --replSet rs0 --dbpath C:\data\rs0 --port 27017
mongosh --eval "rs.initiate()"                      # once, in a second terminal
```

Then use `mongodb://127.0.0.1:27017/smartnav360?replicaSet=rs0` as the connection string.

### 4. Configure the backend

```bash
copy backend\.env.example backend\.env              # macOS/Linux: cp backend/.env.example backend/.env
```

Open `backend/.env` and set:

| Setting | Value |
|---|---|
| `MONGODB_URI` | The connection string from step 3 (required) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Two different random values of 32+ characters. Create each with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. |
| `GEMINI_API_KEY` | Optional. Enables real answers in the AI Workspace. |

Leave the other lines as they are; blank lines mean "use the default". Changing the JWT secrets signs everyone out, but accounts and projects are kept.

### 5. Install packages and download the AI models

```bash
npm --prefix backend install
npm --prefix frontend install
npm --prefix backend run models:fetch
```

`models:fetch` needs internet access once. It downloads the "Where am I?", object-detection and panorama feature-matching models (110 MB, checksum-verified) into `backend/.cache/models`, then times the CPU and each GPU and prints where object detection and feature matching will run, for example `Panorama feature matching runs on: GPU (DirectML adapter 1)`. The SuperPoint weights inside the matching model are released for non-commercial research use; check that this suits your deployment.

### 6. Start the app

**Windows:** double-click `start-demo.bat`, or run `start-demo.bat check` first to test the setup without starting anything. Stop everything with `stop-demo.bat`.

**macOS / Linux**, in two terminals:

```bash
npm --prefix backend start                          # API on http://localhost:5000
npm --prefix frontend run dev                       # app on http://localhost:5173
```

### 7. First sign-in

Open http://localhost:5173 and choose **Create an account** on the sign-in page. The first account on a database becomes the administrator. On an existing database, sign in with your existing account instead; your projects are still there.

### 8. Use a phone on the same Wi-Fi (optional)

`start-demo.bat` sets this up and opens the app at the computer's network address. By hand:

1. Find the computer's address, for example `192.168.1.5` (`ipconfig` on Windows, `ipconfig getifaddr en0` on macOS).
2. In `backend/.env`, set `CORS_ORIGINS=http://localhost:5173,http://192.168.1.5:5173`, then restart the backend.
3. Start the frontend with `npm --prefix frontend run dev -- --host`.
4. On the computer, open `http://192.168.1.5:5173` (not `localhost`), so the capture QR code points somewhere the phone can reach.
5. On Windows, allow Node.js through Windows Firewall on **Private** networks when asked.

For the SmartNav Capture phone app, run `start-demo.bat mobile`, or run `npm --prefix mobile install` and then `npx expo start` in `mobile/` with `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.5:5000` set. Scan the Expo QR code with Expo Go.

### 9. Check that it works

- http://localhost:5000/healthz reports the database as connected.
- `npm --prefix backend test` and `npm --prefix frontend test` pass. The backend tests start their own temporary database, so they do not touch your data.
- In **Virtual Experience**, pick a scene and click **Detect objects**. The labels found appear as buttons, and clicking one turns the view to that object.

### Troubleshooting

| Problem | Fix |
|---|---|
| Backend exits with `Invalid backend environment configuration` | The message names the setting to fix in `backend/.env`. |
| `This operation requires MongoDB transactions` | The database is not a replica set. See step 3. |
| Backend cannot reach Atlas (timeouts) | Add this computer's IP address in Atlas **Network Access**. |
| `Port 5000 is already in use` | Run `stop-demo.bat`, or close the other backend window. |
| Model download fails (no internet) | Copy `backend/.cache/models` from a computer that has it, or set `PLACE_MODEL_PATH` / `OBJECT_MODEL_PATH` / `MATCH_MODEL_PATH` in `backend/.env` to your own copies. |
| Stitching does not say "matched on GPU", or object detection uses the wrong device or is slow | Delete `backend/.cache/models/onnx-devices.json` to time the devices again, or set `ONNX_DEVICE` to `cpu`, `gpu` or `gpu:N` in `backend/.env`. |
| Scenes show broken images | `backend/uploads/` was not copied from the old computer (step 2). |
| Phone shows "server not connected" | Same Wi-Fi as the computer, app opened at the network address rather than `localhost`, `CORS_ORIGINS` includes that address, and the firewall allows Node.js (step 8). |

## Running SmartNav360

### One-click demo (Windows)

Double-click **start-demo.bat** in the project folder. It checks Node.js and `backend/.env`, installs any missing packages, downloads the AI models, starts the backend and frontend in their own windows, waits until both respond, and opens the app at this computer's network address so a phone on the same Wi-Fi can scan the capture QR code. It finishes by printing a suggested demo order.

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
npm run models:fetch        # one-time download of the AI models (110 MB, checksum-verified); also picks CPU or GPU
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
