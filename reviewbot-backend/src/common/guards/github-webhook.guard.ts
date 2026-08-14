import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * GitHub Webhook Guard
 * Validates incoming webhook requests using the X-Hub-Signature-256 header.
 * GitHub signs the raw request body with HMAC-SHA256 using the webhook
 * secret, unlike GitLab which sends the secret as a plain token header -
 * so this guard needs access to the raw (unparsed) body, captured in
 * main.ts's body parser `verify` callback as `req.rawBody`.
 */
@Injectable()
export class GitHubWebhookGuard implements CanActivate {
  private readonly logger = new Logger(GitHubWebhookGuard.name);

  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const signature = request.headers['x-hub-signature-256'];

    if (!signature) {
      this.logger.warn('Webhook request missing X-Hub-Signature-256 header');
      throw new UnauthorizedException('Missing GitHub signature');
    }

    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');

    if (!secret) {
      this.logger.error('GITHUB_WEBHOOK_SECRET not configured in environment');
      throw new UnauthorizedException('Webhook secret not configured');
    }

    const rawBody: Buffer | undefined = request.rawBody;
    if (!rawBody) {
      this.logger.error('Raw request body unavailable - cannot verify signature');
      throw new UnauthorizedException('Unable to verify webhook signature');
    }

    const expectedSignature =
      'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);

    const isValid =
      sigBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(sigBuf, expectedBuf);

    if (!isValid) {
      this.logger.warn('Invalid GitHub webhook signature');
      throw new UnauthorizedException('Invalid GitHub signature');
    }

    this.logger.debug('GitHub webhook signature validated successfully');
    return true;
  }
}
