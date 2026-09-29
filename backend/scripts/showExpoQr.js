/**
 * Prints the QR code Expo Go scans to open this app, for the address given.
 * Used by start-demo.bat, so the code is shown even when Expo's own terminal
 * UI does not draw one.
 *
 * Usage: node backend/scripts/showExpoQr.js <lan-ip> [port]
 */
const qrcode = require('qrcode-terminal');

const [host, port = '8081'] = process.argv.slice(2);
if (!host) {
  console.error('Usage: node backend/scripts/showExpoQr.js <lan-ip> [port]');
  process.exit(1);
}
const url = `exp://${host}:${port}`;
qrcode.generate(url, { small: true }, (code) => {
  console.log(code);
  console.log(`  Scan with Expo Go (Android) or the Camera app (iPhone): ${url}`);
});
