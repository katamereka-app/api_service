import 'multer';

export abstract class StorageService {
  abstract uploadFile(file: Express.Multer.File, folder: string): Promise<string>;
  abstract uploadBuffer(buffer: Buffer, filename: string, folder: string): Promise<string>;
  abstract deleteFile(fileUrl: string): Promise<void>;
}
