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
        runningMode: 'VIDEO', numFaces: 3, minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.5,
      });
      objects = await ObjectDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 's360-assets://local/efficientdet_lite0.tflite', delegate: 'CPU' },
        runningMode: 'VIDEO', scoreThreshold: 0.45, categoryAllowlist: ['cell phone'], maxResults: 5,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
  }
  if (data.type === 'frame') {
    try {
      const faceResult = faces.detectForVideo(data.bitmap, data.timestamp);
      const objectResult = objects.detectForVideo(data.bitmap, data.timestamp);
      const landmarks = faceResult.faceLandmarks || [];
      let headDirection = 'unknown';
      if (landmarks.length === 1) {
        const points = landmarks[0], left = points[33], right = points[263], nose = points[1];
        const offset = (nose.x - (left.x + right.x) / 2) / Math.max(Math.abs(right.x - left.x), 0.01);
        headDirection = offset < -0.3 ? 'left' : offset > 0.3 ? 'right' : 'forward';
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
      self.postMessage({ type: 'sample', faceCount: landmarks.length, phoneConfidence, headDirection, regions });
    } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
    finally { data.bitmap.close(); }
  }
};
