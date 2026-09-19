import "server-only";

export type UploadcareFileInfo = {
  uuid: string;
  mimeType: string;
  size: number;
  originalFileUrl: string;
};

export type UploadcareAdapter = {
  getFileInfo(uuid: string): Promise<UploadcareFileInfo>;
};

export type StoredVideo = {
  publicId: string;
  secureUrl: string;
  format: string;
  bytes: number;
  duration: number;
  width: number;
  height: number;
};

export type CopyVideoOptions = { expectedBytes: number; deadline: number };

export type CloudinaryAdapter = {
  copyVideoFromUrl(url: string, options: CopyVideoOptions): Promise<StoredVideo>;
};

export type Providers = { uploadcare: UploadcareAdapter; cloudinary: CloudinaryAdapter };
