import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean } from 'class-validator';

/**
 * DTO for creating a new project
 */
export class CreateProjectDto {
  @ApiProperty({
    example: 123456789,
    description: 'GitHub repository ID',
  })
  @IsNumber()
  @IsNotEmpty()
  githubRepoId: number;

  @ApiProperty({
    example: 'my-awesome-project',
    description: 'Repository name',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    example: 'my-org',
    description: 'Repository owner (user or organization login)',
  })
  @IsString()
  @IsNotEmpty()
  namespace: string;

  @ApiProperty({
    example: 'https://hooks.example.com/github/webhooks',
    description: 'Webhook URL (optional, generated if not provided)',
    required: false,
  })
  @IsString()
  @IsOptional()
  webhookUrl?: string;

  @ApiProperty({
    example: 'very_secret_token_123',
    description: 'GitHub webhook secret',
  })
  @IsString()
  @IsNotEmpty()
  webhookSecret: string;

  @ApiProperty({
    example: true,
    description: 'Whether the project is active for code reviews',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
