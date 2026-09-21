# Skills & Technologies

This document outlines the technical skills and tools used to build **SmartNav360**, a full-stack 360° virtual tour platform that lets property owners and companies upload panoramic images, stitch them into a navigable Street-View-style experience with a 2D map, and run AI-based object detection on them.

## Frontend

- **React 19** — component-based UI, hooks, context API for shared state (`src/contexts`)
- **Vite** — dev server and production build tooling
- **React Router v7** — client-side routing with lazy-loaded routes (`src/routes`)
- **Ant Design (antd) + Ant Design Icons** — UI component library and design system
- **Marzipano** — WebGL-based 360° panorama rendering and hotspot navigation between scenes
- **Axios** — HTTP client for REST API communication (`src/services`)
- **Day.js** — lightweight date formatting/manipulation
- **oxlint** — fast Rust-based linting for code quality

## Backend

- **Node.js + Express 5** — REST API server (`server.js`, `routes/`, `controllers/`)
- **MongoDB + Mongoose 9** — schema modeling and persistence for Projects, Scenes, Assets, and Analytics Events (`models/`)
- **Multer** — multipart/form-data handling for panorama image uploads (`middleware/uploadMiddleware.js`)
- **dotenv** — environment-based configuration
- **CORS** — cross-origin request handling between frontend and backend
- **Node's built-in test runner** — unit/integration tests (`tests/*.test.cjs`)
- **mongodb-memory-server** — in-memory MongoDB for isolated test runs

## Architecture & Patterns

- **MVC-style backend structure** — clear separation of routes, controllers, models, and services
- **RESTful API design** — resource-oriented endpoints for projects, scenes, features, and uploads
- **Transactional writes** — multi-document operations (e.g. deleting a project's scenes, assets, and analytics together) wrapped in MongoDB transactions via a shared `withProject`/`withScene` helper (`services/integrity.js`)
- **File lifecycle management** — a durable "pending deletion" outbox pattern: a file is only unlinked from disk after its owning record is committed *and* no other Scene/Project/Asset still references it, with automatic background retry (`services/fileCleanup.js`, `models/PendingFileDeletion.js`)
- **Data integrity checks** — centralized request validation (ID shape, allowed fields, hotspot cross-references) shared across controllers (`services/integrity.js`)
- **External service integration** — decoupled computer-vision inference via a self-hosted YOLO/Ultralytics HTTP endpoint, keeping heavyweight ML models out of the web server (`controllers/visionController.js`)

## AI / Computer Vision

- **YOLO-based object detection** — server calls out to an external YOLO inference API to detect and label objects within uploaded 360° scenes, then persists detected labels as scene metadata

## UI/UX Design System

- **Design tokens** — a single CSS custom-property source of truth (`styles/variables.css`) for color, spacing, typography, radius, shadow, and z-index, with a parallel `[data-theme='dark']` override block for light/dark theming
- **Component-driven consistency** — shared primitives (`Logo`, `EmptyState`, `WorkspaceHeader`, `SearchBar`, `ConfirmDialog`) reused across pages instead of one-off markup, reducing visual drift
- **Street-View-style interaction design** — click-to-place hotspot pins directly on the 360° panorama (Google Maps/Street View-style linking) instead of manual coordinate entry, with click-to-remove on existing pins
- **Responsive navigation** — collapsible desktop sidebar with localStorage-persisted state, paired with a slide-out mobile drawer (Ant Design `Drawer`) below the tablet breakpoint
- **Functional wayfinding** — real breadcrumbs and a quick-jump command search derived from a single flattened route/nav config, plus a live project-switcher dropdown, replacing decorative/non-functional nav chrome

## Tooling & Workflow

- **npm** workspaces for frontend/backend dependency management
- **Postman** collections for API testing and documentation (`backend/postman`, `.postman/resources.yaml`)
- **Git** version control
- **Verification loop** — using `oxlint` and `vite build` as fast correctness gates after refactors, plus live smoke-testing against the running backend/MongoDB Atlas instance (curl against real endpoints) rather than trusting code review alone
