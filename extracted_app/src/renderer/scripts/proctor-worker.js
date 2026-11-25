self.exports = {};
importScripts('s360-assets://local/vision_bundle.js');
const { FilesetResolver, FaceLandmarker, ObjectDetector } = self.exports;
let faces, objects;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const vision = await FilesetResolver.forVisionTasks('s360-assets://local/wasm');
      faces = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 's360-assets://local/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 3, minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.55, minTrackingConfidence: 0.5,
      });
      objects = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 's360-assets://local/efficientdet_lite0.tflite', delegate: 'CPU' },
        // Pass candidate scores to the main process, which applies the warning threshold.
        runningMode: 'VIDEO', scoreThreshold: 0.18, categoryAllowlist: ['cell phone'], maxResults: 8,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  }
  if (data.type === 'frame') {
    try {
      const faceResult = faces.detectForVideo(data.bitmap, data.timestamp);
      const objectResult = objects.detectForVideo(data.bitmap, data.timestamp);
      const landmarks = faceResult.faceLandmarks || [];
      let headDirection = 'unknown', eyeDirection = 'unknown', headOffset = null, gazeOffset = null;
      if (landmarks.length === 1) {
        const points = landmarks[0], left = points[33], right = points[263], nose = points[1];
        const offset = (nose.x - (left.x + right.x) / 2) / Math.max(Math.abs(right.x - left.x), 0.01); headOffset=offset;
        // Smaller but sustained changes are handled by the main temporal
        // policy, so a brief natural movement remains only an ignored sample.
        headDirection = offset < -0.16 ? 'left' : offset > 0.16 ? 'right' : 'forward';
        // Iris centres (FaceMesh refined landmarks) relative to eye corners.
        const lIris=points[468], rIris=points[473], lOuter=points[33], lInner=points[133], rInner=points[362], rOuter=points[263];
        if(lIris&&rIris&&lOuter&&lInner&&rInner&&rOuter){
          const l=(lIris.x-(lOuter.x+lInner.x)/2)/Math.max(Math.abs(lOuter.x-lInner.x),.01);
          const r=(rIris.x-(rInner.x+rOuter.x)/2)/Math.max(Math.abs(rInner.x-rOuter.x),.01);
          // Discard blinks and inconsistent iris estimates before counting a gaze shift.
          const leftOpen = Math.abs(points[159].y - points[145].y) * data.bitmap.height;
          const rightOpen = Math.abs(points[386].y - points[374].y) * data.bitmap.height;
          if (leftOpen > .12 * Math.abs(lOuter.x - lInner.x) * data.bitmap.width &&
              rightOpen > .12 * Math.abs(rOuter.x - rInner.x) * data.bitmap.width && Math.abs(l-r) < .2) {
            gazeOffset = (l + r) / 2;
            eyeDirection = gazeOffset < -.12 ? 'left' : gazeOffset > .12 ? 'right' : 'forward';
          }
        }
      }
      const phoneConfidence = Math.max(0, ...objectResult.detections.flatMap(detection => detection.categories.filter(category => category.categoryName === 'cell phone').map(category => category.score)));
      const regions = landmarks.map(points => {
        const xs=points.map(point=>point.x),ys=points.map(point=>point.y);
        const x=Math.max(0,Math.min(...xs)),y=Math.max(0,Math.min(...ys));
        return {type:'face',x,y,width:Math.min(1,Math.max(...xs))-x,height:Math.min(1,Math.max(...ys))-y};
      });
      for (const detection of objectResult.detections) {
        const category=detection.categories.find(item=>item.categoryName==='cell phone');
        if(category){const box=detection.boundingBox;regions.push({type:'phone',x:Math.max(0,box.originX/data.bitmap.width),y:Math.max(0,box.originY/data.bitmap.height),width:Math.min(1,box.width/data.bitmap.width),height:Math.min(1,box.height/data.bitmap.height),score:category.score});}
      }
      self.postMessage({ type: 'sample', faceCount: landmarks.length, phoneConfidence, headDirection, eyeDirection, headOffset, gazeOffset, regions });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { data.bitmap.close(); }
  }
};
