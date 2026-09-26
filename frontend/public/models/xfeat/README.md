# XFeat keypoint model

Used by the panorama stitcher (`src/utils/panorama/learnedFeatures.js`) to find
matching points between neighbouring photos. Loaded only when a stitch runs.

| File | SHA-256 |
|------|---------|
| `xfeat_backbone.onnx` | `86d7d549b380405f208933efb5202e1584d9762f3a72e06e7ed81ca1436972e0` |
| `xfeat_backbone.onnx.data` | `d4498528d37bf7c737cce9c135f9b0340d828bab7dc808339e50553ac8c1b7d9` |

- **Model:** XFeat — Accelerated Features for Lightweight Image Matching
  (Potje, Cadar, Araujo, Martins, Nascimento; CVPR 2024).
- **Weights and ONNX export:** [kornia/xfeat](https://huggingface.co/kornia/xfeat)
  on Hugging Face. Original code: [verlab/accelerated_features](https://github.com/verlab/accelerated_features).
- **License:** Apache License 2.0 — see `LICENSE` in this directory.

The `.onnx` file stores its weights externally in `.onnx.data`; keep both files
together and with these exact names, because the graph references the data file
by name.

Interface (verified against the file):

- input `image` — float32 `[1, 3, H, W]`, RGB in 0..1, H and W multiples of 32
- output `heatmap` — `[1, 1, H, W]` keypoint probability
- output `reliability` — `[1, 1, H, W]` descriptor reliability
- output `descriptors` — `[1, 64, H/8, W/8]`, unit length per cell
