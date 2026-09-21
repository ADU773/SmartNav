/**
 * SmartNav360 — Puter AI Service
 * Wraps Puter.js (a free, hosted AI/cloud SDK — puter.com) to turn a 2D
 * floor-plan image into a photorealistic top-down 3D render. Signing in is a
 * separate Puter.com account, unrelated to SmartNav360's own login.
 */

import puter from '@heyputer/puter.js';

export const FLOORPLAN_RENDER_PROMPT = `
TASK: Convert the input 2D floor plan into a **photorealistic, top-down 3D architectural render**.

STRICT REQUIREMENTS (do not violate):
1) **REMOVE ALL TEXT**: Do not render any letters, numbers, labels, dimensions, or annotations. Floors must be continuous where text used to be.
2) **GEOMETRY MUST MATCH**: Walls, rooms, doors, and windows must follow the exact lines and positions in the plan. Do not shift or resize.
3) **TOP-DOWN ONLY**: Orthographic top-down view. No perspective tilt.
4) **CLEAN, REALISTIC OUTPUT**: Crisp edges, balanced lighting, and realistic materials. No sketch/hand-drawn look.
5) **NO EXTRA CONTENT**: Do not add rooms, furniture, or objects that are not clearly indicated by the plan.

STRUCTURE & DETAILS:
- **Walls**: Extrude precisely from the plan lines. Consistent wall height and thickness.
- **Doors**: Convert door swing arcs into open doors, aligned to the plan.
- **Windows**: Convert thin perimeter lines into realistic glass windows.

FURNITURE & ROOM MAPPING (only where icons/fixtures are clearly shown):
- Bed icon -> realistic bed with duvet and pillows.
- Sofa icon -> modern sectional or sofa.
- Dining table icon -> table with chairs.
- Kitchen icon -> counters with sink and stove.
- Bathroom icon -> toilet, sink, and tub/shower.
- Office/study icon -> desk, chair, and minimal shelving.
- Porch/patio/balcony icon -> outdoor seating or simple furniture (keep minimal).
- Utility/laundry icon -> washer/dryer and minimal cabinetry.

STYLE & LIGHTING:
- Lighting: bright, neutral daylight. High clarity and balanced contrast.
- Materials: realistic wood/tile floors, clean walls, subtle shadows.
- Finish: professional architectural visualization; no text, no watermarks, no logos.
`.trim();

/**
 * Opens Puter's hosted sign-in flow. Resolves immediately if already signed in.
 */
export async function signInToPuter() {
  return puter.auth.signIn();
}

/**
 * Reads a File as a base64 data URL.
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Sends a 2D floor-plan image to Puter's hosted Gemini image model and
 * returns the rendered image as a data URL.
 * @param {File} sourceFile - The uploaded 2D floor-plan image.
 * @returns {Promise<string>} data: URL of the rendered image.
 */
export async function generateFloorPlanRender(sourceFile) {
  const dataUrl = await readFileAsDataUrl(sourceFile);
  const base64Data = dataUrl.split(',')[1];
  const mimeType = dataUrl.split(';')[0].split(':')[1];

  if (!base64Data || !mimeType) throw new Error('Could not read the floor plan image.');

  await signInToPuter();

  const response = await puter.ai.txt2img(FLOORPLAN_RENDER_PROMPT, {
    provider: 'gemini',
    model: 'gemini-2.5-flash-image-preview',
    input_image: base64Data,
    input_image_mime_type: mimeType,
    ratio: { w: 1024, h: 1024 },
  });

  const rawImageUrl = response?.src;
  if (!rawImageUrl) throw new Error('Puter did not return a rendered image.');
  if (rawImageUrl.startsWith('data:')) return rawImageUrl;

  const imageResponse = await fetch(rawImageUrl);
  const blob = await imageResponse.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
