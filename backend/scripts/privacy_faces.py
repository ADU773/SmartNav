"""Local face proposals. Input: JPEG preview on stdin. Output: normalized rectangles."""
import json
import sys
import cv2
import numpy as np

gray = cv2.imdecode(np.frombuffer(sys.stdin.buffer.read(), np.uint8), cv2.IMREAD_GRAYSCALE)
if gray is None:
    raise ValueError("Invalid preview")
h, w = gray.shape
tile = min(900, w, h)
step = max(1, tile * 3 // 4)
wrapped = np.concatenate((gray, gray), axis=1)
models = [cv2.CascadeClassifier(cv2.data.haarcascades + name) for name in
          ("haarcascade_frontalface_default.xml", "haarcascade_profileface.xml")]
boxes = []
for top in sorted({min(y, h - tile) for y in range(0, h, step)}):
    for left in range(0, w, step):
        patch = cv2.equalizeHist(wrapped[top:top+tile, left:left+tile])
        for model, flip in [(models[0], False), (models[1], False), (models[1], True)]:
            for x, y, bw, bh in model.detectMultiScale(cv2.flip(patch, 1) if flip else patch, 1.15, 5, minSize=(20,20)):
                x = left + (tile-x-bw if flip else x)
                start = int(x-bw*.2) % w
                length = min(w, int(bw*1.4))
                y1, y2 = max(0, int(top+y-bh*.25)), min(h, int(top+y+bh*1.25))
                for a,b in [(start,min(w,start+length)), (0,max(0,start+length-w))]:
                    if b>a:
                        boxes.append([a,y1,b-a,y2-y1])
keep = np.asarray(cv2.dnn.NMSBoxes(boxes,[1.0]*len(boxes),0.1,0.45), dtype=int).flatten()
print(json.dumps([dict(x=x/w,y=y/h,w=bw/w,h=bh/h) for x,y,bw,bh in (boxes[i] for i in keep)]))
