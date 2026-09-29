/**
 * Downloads the AI models (checksum-verified) and times the CPU and each GPU
 * for the ones that can use a GPU, so the first request is not the one waiting.
 *
 *   npm run models:fetch                 every model except the optional large ones
 *   npm run models:fetch -- depth ocr    only these (ids from the list it prints)
 *   npm run models:fetch -- --all        everything, optional models included
 *   npm run models:fetch -- --list       show the models and exit
 */

const fs = require("fs");
const path = require("path");
const modelStore = require("../services/modelStore");
const { describeDevice } = require("../services/onnxDevice");

// Model modules register themselves when loaded: the three original ones, and
// every module under services/ml.
require("../services/placeModel");
require("../services/objectModel");
require("../services/featureMatchModel");
const mlDirectory = path.join(__dirname, "..", "services", "ml");
for (const file of fs.existsSync(mlDirectory) ? fs.readdirSync(mlDirectory).sort() : []) {
    if (/Model\.js$/.test(file)) require(path.join(mlDirectory, file));
}

(async () => {
    const args = process.argv.slice(2);
    const all = modelStore.models();
    if (args.includes("--list")) {
        for (const model of all) {
            console.log(`${model.id.padEnd(12)} ${model.isCached() ? "downloaded " : "missing    "} ${model.optional ? "(optional) " : ""}${model.label}`);
        }
        return;
    }
    const named = args.filter((arg) => !arg.startsWith("--"));
    const unknown = named.filter((id) => !all.some((model) => model.id === id));
    if (unknown.length) throw new Error(`Unknown model(s): ${unknown.join(", ")}. Known: ${all.map((m) => m.id).join(", ")}.`);
    const chosen = named.length ? all.filter((model) => named.includes(model.id))
        : all.filter((model) => args.includes("--all") || !model.optional);
    const skipped = all.filter((model) => !chosen.includes(model));

    for (const model of chosen) {
        process.stdout.write(`${model.label}: `);
        await model.ensureFiles();
        console.log("ready");
    }
    // One after another: each times the GPU, and overlapping runs would skew the timings.
    for (const model of chosen.filter((m) => m.usesGpu)) {
        const { device } = await model.prepareDevice();
        console.log(`${model.label} runs on: ${describeDevice(device)}`);
    }
    if (skipped.length) {
        console.log(`Not downloaded (optional or not named): ${skipped.map((m) => m.id).join(", ")}. Name them, or pass --all.`);
    }
})().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
