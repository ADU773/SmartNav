/**
 * Downloads the AI models (checksum-verified) and times the CPU and each GPU
 * for the ones that can use a GPU, so the first request is not the one waiting.
 * Run with: npm run models:fetch
 */

const objectModel = require("../services/objectModel");
const matchModel = require("../services/featureMatchModel");
const placeModel = require("../services/placeModel");
const { describeDevice } = require("../services/onnxDevice");

(async () => {
    const files = await Promise.all([placeModel.ensureModelFile(), objectModel.ensureModelFile(), matchModel.ensureModelFile()]);
    console.log("Models ready:", files.join(", "));
    // One after another: each times the GPU, and overlapping runs would skew the timings.
    const objects = await objectModel.prepareDevice();
    console.log("Object detection runs on:", describeDevice(objects.device));
    const matching = await matchModel.prepareDevice();
    console.log("Panorama feature matching runs on:", describeDevice(matching.device));
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
