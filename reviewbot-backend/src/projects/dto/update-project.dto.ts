import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsNumber, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';

/**
 * DTO for updating an existing project
 * All fields optional, declared explicitly (not via PartialType) to avoid
 * any type-resolution issues with mapped-types across environments.
 */
export class UpdateProjectDto {
  @ApiProperty({ example: 123456789, description: 'GitHub repository ID', required: false })
  @IsNumber()
  @IsOptional()
  githubRepoId?: number;

  @ApiProperty({ example: 'my-awesome-project', description: 'Repository name', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ example: 'my-org', description: 'Repository owner (user or organization login)', required: false })
  @IsString()
  @IsOptional()
  namespace?: string;

  @ApiProperty({ example: 'https://hooks.example.com/github/webhooks', description: 'Webhook URL', required: false })
  @IsString()
  @IsOptional()
  webhookUrl?: string;

  @ApiProperty({ example: 'very_secret_token_123', description: 'GitHub webhook secret', required: false })
  @IsString()
  @IsOptional()
  webhookSecret?: string;

  @ApiProperty({
    example: true,
    description: 'Whether the project is active for code reviews',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({
    example: 70,
    description: 'Merge gate: minimum quality score required to auto-approve a PR (null/omit disables gating - reviews just get a comment)',
    required: false,
    nullable: true,
  })
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  minMergeScore?: number | null;

  @ApiProperty({
    example: 'Require JSDoc comments on all exported functions. Prefer named exports over default exports.',
    description: 'Project-specific review conventions, appended to the AI review prompt',
    required: false,
    nullable: true,
  })
  @IsString()
  @IsOptional()
  styleGuide?: string | null;
}
