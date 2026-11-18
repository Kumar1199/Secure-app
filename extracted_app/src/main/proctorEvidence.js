function sanitizeEvidence(evidence) {
  if (!evidence || typeof evidence.image !== 'string' || evidence.image.length > 180000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(evidence.image)) return null;
  const bytes = Buffer.from(evidence.image.slice(23), 'base64');
  if (bytes.length < 16 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length-2] !== 255 || bytes[bytes.length-1] !== 217) return null;
  let width, height;
  for (let offset=2; offset+9<bytes.length;) {
    if (bytes[offset] !== 255) return null;
    const marker=bytes[offset+1], length=bytes.readUInt16BE(offset+2);
    if (length<2 || offset+length+2>bytes.length) return null;
    if (marker===192 || marker===194) { height=bytes.readUInt16BE(offset+5); width=bytes.readUInt16BE(offset+7); break; }
    if (marker===218 || marker===217) break;
    offset+=length+2;
  }
  if (!width || !height || width>640 || height>480) return null;
  const regions = (Array.isArray(evidence.regions) ? evidence.regions : []).slice(0,8).filter(region =>
    ['face','phone'].includes(region?.type) && ['x','y','width','height'].every(key=>Number.isFinite(region[key]) && region[key]>=0 && region[key]<=1)
  ).map(region=>({type:region.type,x:region.x,y:region.y,width:Math.min(region.width,1-region.x),height:Math.min(region.height,1-region.y),...(Number.isFinite(region.score)?{score:Math.max(0,Math.min(1,region.score))}:{})}));
  return { image:evidence.image,width,height,regions,capturedAt:Number.isFinite(Date.parse(evidence.capturedAt))?new Date(evidence.capturedAt).toISOString():new Date().toISOString() };
}
module.exports = { sanitizeEvidence };
