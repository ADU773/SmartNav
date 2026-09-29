/**
 * Times one ONNX model on one device and prints the result as JSON.
 *
 * Run as a child process by onnxDevice.js, one device per process, so a GPU
 * driver that crashes the process (as some do) only rules out that device.
 *
 * Usage: node onnxDeviceProbe.js '<json: { file, inputName, inputShape, inputs?, device }>'
 * where device is "cpu" or a DirectML adapter index, and `inputs` (name to
 * shape) replaces inputName/inputShape for a graph with several inputs.
 */

const ort = require("onnxruntime-node");

const RUNS = 3;

(async () => {
    const { file, inputName, inputShape, inputs, device } = JSON.parse(process.argv[2]);
    const options = device === "cpu"
        ? {}
        : { executionProviders: [{ name: "dml", deviceId: device }], enableMemPattern: false, executionMode: "sequential" };
    const session = await ort.InferenceSession.create(file, { graphOptimizationLevel: "all", ...options });
    const feeds = {};
    for (const [name, shape] of Object.entries(inputs || { [inputName]: inputShape })) {
        const size = shape.reduce((a, b) => a * b, 1);
        const data = new Float32Array(size);
        for (let i = 0; i < size; i += 1) data[i] = ((i * 37) % 255) / 255;
        feeds[name] = new ort.Tensor("float32", data, shape);
    }
    await session.run(feeds); // warm-up: the first run includes one-time setup
    const times = [];
    for (let i = 0; i < RUNS; i += 1) {
        const start = process.hrtime.bigint();
        await session.run(feeds);
        times.push(Number(process.hrtime.bigint() - start) / 1e6);
    }
    times.sort((a, b) => a - b);
    process.stdout.write(JSON.stringify({ ms: times[Math.floor(times.length / 2)] }));
})().catch((error) => {
    process.stdout.write(JSON.stringify({ error: error.message.split("\n")[0] }));
    process.exitCode = 1;
});
