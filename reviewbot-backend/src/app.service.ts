import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Code Buddy Backend API - Ready to review your code!';
  }
}
