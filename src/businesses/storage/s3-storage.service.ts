import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import 'multer';
import { StorageService } from './storage.service.js';

@Injectable()
export class S3StorageService implements StorageService {
  private readonly logger = new Logger(S3StorageService.name);
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly keyPrefix: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('STORAGE_REGION') || 'ap-southeast-1';
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT');
    const accessKeyId = this.configService.get<string>('STORAGE_ACCESS_KEY_ID') || '';
    const secretAccessKey = this.configService.get<string>('STORAGE_SECRET_ACCESS_KEY') || '';

    this.bucket = this.configService.get<string>('STORAGE_BUCKET') || 'transgo-minio';
    this.publicBaseUrl = this.configService.get<string>('STORAGE_PUBLIC_BASE_URL') || `https://${this.bucket}.s3.${region}.amazonaws.com`;
    this.keyPrefix = this.configService.get<string>('STORAGE_KEY_PREFIX') || 'kabarify';

    this.s3Client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }

  async uploadFile(file: Express.Multer.File, folder: string): Promise<string> {
    const cleanFilename = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const key = `${this.keyPrefix}/${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}_${cleanFilename}`;
    
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  async uploadBuffer(buffer: Buffer, filename: string, folder: string): Promise<string> {
    const key = `${this.keyPrefix}/${folder}/${filename}`;
    
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: 'image/jpeg',
      }),
    );
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }

  async deleteFile(fileUrl: string): Promise<void> {
    if (!fileUrl) return;
    try {
      const key = fileUrl.replace(`${this.publicBaseUrl}/`, '').replace(/^\//, '');
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch (err) {
      this.logger.error(`Error deleting file from S3: ${fileUrl}`, err);
    }
  }
}
