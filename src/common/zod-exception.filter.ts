import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ZodError } from 'zod';
import multer from 'multer';
import type { Response } from 'express';

const { MulterError } = multer;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof MulterError) {
      const message =
        exception.code === 'LIMIT_FILE_SIZE'
          ? `Ukuran file melebihi batas maksimum 5 MB.`
          : `Upload error: ${exception.message}`;
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message,
      });
      return;
    }

    if (exception instanceof ZodError) {
      const messages = exception.issues.map((e) => `${e.path.join('.')}: ${e.message}`);
      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: messages[0] ?? 'Data tidak valid',
        details: messages,
      });
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Terjadi kesalahan internal',
    });
  }
}
