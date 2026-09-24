/**
 * SmartNav360 — Rotation maths for panorama registration
 *
 * A panorama shot by turning in place is a pure-rotation problem: every frame
 * sees the same optical centre, so frames differ by a 3D rotation and nothing
 * else. That is why this module deals in unit rays and rotation matrices
 * rather than the planar homographies the original stitcher chained together
 * (a homography can encode translation and shear it has no right to, which is
 * how that approach drifted without bound).
 *
 * World frame: x = right/east, y = up, z = forward at yaw 0.
 * Camera frame: x = right across the image, y = up, z = out along the lens.
 * A frame's rotation matrix R maps camera coordinates into world coordinates.
 *
 * No DOM and no OpenCV here on purpose — this is the part worth testing in
 * isolation.
 */

export const DEG = Math.PI / 180;

/* ---- Small vector/matrix helpers (3x3 matrices as flat row-major arrays) ---- */

export function normalize(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function matMul(a, b) {
  const out = new Array(9);
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      out[row * 3 + col] =
        a[row * 3] * b[col] + a[row * 3 + 1] * b[3 + col] + a[row * 3 + 2] * b[6 + col];
    }
  }
  return out;
}

export function matTranspose(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export function matApply(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function rotY(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

export function rotX(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}

export function rotZ(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

/**
 * Builds a camera-to-world rotation from the capture metadata the phone
 * reports: yaw grows clockwise, pitch is camera elevation above the horizon,
 * roll is rotation about the lens axis.
 */
export function rotationFromYawPitchRoll(yawRad, pitchRad, rollRad) {
  return matMul(matMul(rotY(yawRad), rotX(-pitchRad)), rotZ(rollRad));
}

/** Inverse of rotationFromYawPitchRoll, for reporting and for yaw-band maths. */
export function yawPitchRollFromRotation(m) {
  // Forward axis (third column) gives yaw and pitch directly.
  const forward = [m[2], m[5], m[8]];
  const yaw = Math.atan2(forward[0], forward[2]);
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward[1])));
  // Strip yaw and pitch, then read the residual roll off the right axis.
  const withoutYawPitch = matMul(matTranspose(matMul(rotY(yaw), rotX(-pitch))), m);
  const roll = Math.atan2(withoutYawPitch[3], withoutYawPitch[0]);
  return { yaw, pitch, roll };
}

/* ---- Axis-angle, used to spread loop-closure error over every frame ---- */

export function rotationToAxisAngle(m) {
  const trace = m[0] + m[4] + m[8];
  const cosAngle = Math.max(-1, Math.min(1, (trace - 1) / 2));
  const angle = Math.acos(cosAngle);
  if (angle < 1e-8) return { axis: [0, 1, 0], angle: 0 };
  if (Math.PI - angle < 1e-6) {
    // Near 180°: read the axis off the diagonal, which stays well conditioned.
    const axis = normalize([
      Math.sqrt(Math.max(0, (m[0] + 1) / 2)),
      Math.sqrt(Math.max(0, (m[4] + 1) / 2)),
      Math.sqrt(Math.max(0, (m[8] + 1) / 2)),
    ]);
    return { axis, angle };
  }
  const scale = 1 / (2 * Math.sin(angle));
  return { axis: normalize([(m[7] - m[5]) * scale, (m[2] - m[6]) * scale, (m[3] - m[1]) * scale]), angle };
}

export function axisAngleToRotation(axis, angle) {
  const [x, y, z] = normalize(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

/** Angle in radians between two unit vectors. */
export function angleBetween(a, b) {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(dot);
}

/* ---- Symmetric eigen-decomposition (cyclic Jacobi) ---- */

/**
 * Eigen-decomposition of a symmetric n x n matrix.
 * @param {number[][]} input - symmetric matrix, row-major nested arrays.
 * @returns {{ values: number[], vectors: number[][] }} vectors[i] is the
 *   eigenvector for values[i], sorted descending by eigenvalue.
 */
export function symmetricEigen(input) {
  const n = input.length;
  const a = input.map((row) => row.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < 100; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    }
    if (off < 1e-24) break;

    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return {
    values: order.map((i) => a[i][i]),
    vectors: order.map((i) => v.map((row) => row[i])),
  };
}

/* ---- Rotation fitting ---- */

/**
 * Horn's quaternion solution to the absolute-orientation problem: finds the
 * rotation R minimising the angle between R * from[k] and to[k].
 *
 * The quaternion form is used rather than an SVD of the covariance matrix
 * because it can only ever produce a proper rotation — there is no reflection
 * case to detect and patch up.
 *
 * @param {number[][]} from - unit vectors in the source frame.
 * @param {number[][]} to - matching unit vectors in the target frame.
 * @returns {number[]|null} 3x3 rotation, or null when the inputs are degenerate.
 */
export function fitRotation(from, to) {
  if (from.length < 2 || from.length !== to.length) return null;

  // Covariance H = sum(from_k * to_k^T).
  const h = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < from.length; k += 1) {
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) h[i * 3 + j] += from[k][i] * to[k][j];
    }
  }

  const [sxx, sxy, sxz, syx, syy, syz, szx, szy, szz] = h;
  const n = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];

  const { values, vectors } = symmetricEigen(n);
  if (!Number.isFinite(values[0])) return null;
  const q = vectors[0];
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!length || !Number.isFinite(length)) return null;
  const [w, x, y, z] = q.map((value) => value / length);

  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/**
 * RANSAC wrapper around fitRotation.
 *
 * Feature matching always returns some confidently wrong pairs — repeated
 * architecture, foliage, a reflection. A least-squares fit over all of them is
 * dragged off by the outliers, so the model is fitted to random minimal
 * samples first and only refitted once the inlier set is known.
 *
 * @param {number[][]} from - unit vectors in the source frame.
 * @param {number[][]} to - matching unit vectors in the target frame.
 * @param {{ threshold?: number, iterations?: number, minInliers?: number, random?: () => number }} [options]
 * @returns {{ rotation: number[], inliers: number[], medianErrorRad: number }|null}
 */
export function fitRotationRansac(from, to, options = {}) {
  const {
    threshold = 1.5 * DEG,
    iterations = 256,
    minInliers = 8,
    random = Math.random,
  } = options;
  const count = from.length;
  if (count < Math.max(2, minInliers)) return null;

  let best = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const a = Math.floor(random() * count);
    let b = Math.floor(random() * count);
    if (a === b) b = (b + 1) % count;
    // Two well-separated rays pin down all three degrees of freedom; nearly
    // parallel ones leave the roll about them unconstrained.
    if (angleBetween(from[a], from[b]) < 5 * DEG) continue;

    const candidate = fitRotation([from[a], from[b]], [to[a], to[b]]);
    if (!candidate) continue;

    const inliers = [];
    for (let k = 0; k < count; k += 1) {
      if (angleBetween(matApply(candidate, from[k]), to[k]) <= threshold) inliers.push(k);
    }
    if (!best || inliers.length > best.inliers.length) best = { inliers };
    if (inliers.length > count * 0.9) break;
  }

  if (!best || best.inliers.length < minInliers) return null;

  const refined = fitRotation(
    best.inliers.map((k) => from[k]),
    best.inliers.map((k) => to[k]),
  );
  if (!refined) return null;

  const errors = best.inliers
    .map((k) => angleBetween(matApply(refined, from[k]), to[k]))
    .sort((x, y) => x - y);

  return {
    rotation: refined,
    inliers: best.inliers,
    medianErrorRad: errors[Math.floor(errors.length / 2)],
  };
}

/**
 * Converts a pixel to a unit ray in camera coordinates.
 * Image y grows downward while the camera's y axis points up, hence the flip —
 * getting this backwards mirrors every frame about the horizon.
 */
export function pixelToRay(x, y, cx, cy, focal) {
  return normalize([x - cx, -(y - cy), focal]);
}

/** Focal length in pixels for a given field of view across `pixels`. */
export function focalFromFov(pixels, fovRad) {
  return pixels / 2 / Math.tan(fovRad / 2);
}

export function fovFromFocal(pixels, focal) {
  return 2 * Math.atan(pixels / 2 / focal);
}
