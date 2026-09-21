# Skills & Technologies

This document outlines the technical skills and tools used to build **SmartNav360**, a full-stack 360° virtual tour platform that lets users upload panoramic scenes, link them into navigable tours, and run AI-based object detection on them.

## Frontend

- **React 19** — component-based UI, hooks, context API for shared state (`src/contexts`)
- **Vite** — dev server and production build tooling
- **React Router v7** — client-side routing (`src/routes`)
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
- **File lifecycle management** — scheduled/background cleanup of orphaned uploads (`services/fileCleanup.js`) and pending-deletion tracking (`models/PendingFileDeletion.js`)
- **Data integrity checks** — dedicated integrity verification service and test suite (`services/integrity.js`)
- **External service integration** — decoupled computer-vision inference via a self-hosted YOLO/Ultralytics HTTP endpoint, keeping heavyweight ML models out of the web server (`controllers/visionController.js`)

## AI / Computer Vision

- **YOLO-based object detection** — server calls out to an external YOLO inference API to detect and label objects within uploaded 360° scenes, then persists detected labels as scene metadata

## Tooling & Workflow

- **npm** workspaces for frontend/backend dependency management
- **Postman** collections for API testing and documentation (`backend/postman`, `.postman/resources.yaml`)
- **Git** version control
