const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requestedDevice, sessionOptions, chooseDevice, describeDevice } = require('../services/onnxDevice');

test('ONNX_DEVICE picks automatic choice, the CPU, or a DirectML adapter', () => {
    assert.equal(requestedDevice(undefined), 'auto');
    assert.equal(requestedDevice(''), 'auto');
    assert.equal(requestedDevice('CPU'), 'cpu');
    assert.equal(requestedDevice('gpu'), 0);
    assert.equal(requestedDevice('gpu:1'), 1);
});

test('GPU sessions use DirectML without memory patterns or parallel execution', () => {
    assert.deepEqual(sessionOptions('cpu'), {});
    assert.deepEqual(sessionOptions(1), { executionProviders: [{ name: 'dml', deviceId: 1 }], enableMemPattern: false, executionMode: 'sequential' });
    assert.equal(describeDevice(1), 'GPU (DirectML adapter 1)');
});

test('an explicit ONNX_DEVICE is used as given, with no timing run', async (t) => {
    const saved = process.env.ONNX_DEVICE;
    t.after(() => { if (saved === undefined) delete process.env.ONNX_DEVICE; else process.env.ONNX_DEVICE = saved; });
    // The model file does not exist: any attempt to time it would fail.
    const spec = { key: 'test', file: 'missing.onnx', inputName: 'x', inputShape: [1] };
    process.env.ONNX_DEVICE = 'cpu';
    assert.deepEqual(await chooseDevice(spec), { device: 'cpu', options: {} });
    process.env.ONNX_DEVICE = 'gpu:2';
    assert.equal((await chooseDevice(spec)).device, 2);
});
