import {
  Controller,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { PresenterOnly } from '../auth/decorators';
import { storeImage } from './storage';

const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp|svg\+xml)$/;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

@PresenterOnly()
@Controller('api/assets')
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // Kept in memory (max 5 MB), then written to Supabase Storage or the local uploads/ folder.
      storage: memoryStorage(),
      limits: { fileSize: MAX_SIZE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.test(file.mimetype)) {
          cb(
            new UnprocessableEntityException(
              'Hanya file gambar (JPEG, PNG, GIF, WebP, SVG) yang diizinkan.',
            ),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) throw new UnprocessableEntityException('File tidak ditemukan dalam request.');
    const name = `${randomBytes(12).toString('hex')}${extname(file.originalname).toLowerCase()}`;
    // PUBLIC_URL wins; otherwise derive from the request (trust proxy makes this https behind a proxy).
    const baseUrl = process.env['PUBLIC_URL']?.replace(/\/+$/, '') || `${req.protocol}://${req.get('host')}`;
    try {
      return { url: await storeImage(name, file.buffer, file.mimetype, baseUrl) };
    } catch (err) {
      this.logger.error(err);
      throw new InternalServerErrorException('Gagal menyimpan gambar.');
    }
  }
}
