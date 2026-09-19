const DELIVERY_BASE = "https://res.cloudinary.com";
const POSTER_TRANSFORMATION = "/video/upload/so_0/";

function encodePublicId(publicId: string): string {
  return publicId.split("/").map(encodeURIComponent).join("/");
}

export function videoUrl(cloudName: string, publicId: string, format: string): string {
  return `${DELIVERY_BASE}/${cloudName}/video/upload/${encodePublicId(publicId)}.${format}`;
}

export function posterUrl(cloudName: string, publicId: string): string {
  return `${DELIVERY_BASE}/${cloudName}${POSTER_TRANSFORMATION}${encodePublicId(publicId)}.jpg`;
}

export function posterAtWidth(url: string, width: number): string {
  return url.replace(POSTER_TRANSFORMATION, `/video/upload/so_0,w_${width},c_limit,q_auto/`);
}
