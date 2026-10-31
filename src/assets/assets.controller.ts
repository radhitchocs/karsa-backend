import {
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  UnprocessableEntityException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import type { Request } from 'express';
import { PresenterOnly } from '../auth/decorators';

const UPLOADS_DIR = join(process.cwd(), 'uploads');
const ALLOWED_MIME = /^image\/(jpeg|png|gif|webp|svg\+xml)$/;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

@PresenterOnly()
@Controller('api/assets')
export class AssetsController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req, file, cb) => {
          const rand = randomBytes(12).toString('hex');
          cb(null, `${rand}${extname(file.originalname)}`);
        },
      }),
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
  upload(@UploadedFile() file: Express.Multer.File, @Req() req: Request) {
    if (!file) throw new UnprocessableEntityException('File tidak ditemukan dalam request.');
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return { url: `${baseUrl}/uploads/${file.filename}` };
  }
}
