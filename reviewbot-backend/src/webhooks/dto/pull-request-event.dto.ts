import { IsNotEmpty, IsNumber, IsString, IsBoolean, IsOptional, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * GitHub User DTO (the PR author, found at pull_request.user)
 */
export class GitHubUserDto {
  @IsNumber()
  id: number;

  @IsString()
  @MaxLength(255)
  login: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  avatar_url?: string;
}

/**
 * GitHub Repository DTO
 */
export class GitHubRepositoryDto {
  @IsNumber()
  id: number;

  @IsString()
  @MaxLength(500)
  name: string;

  @ValidateNested()
  @Type(() => GitHubUserDto)
  owner: GitHubUserDto;

  @IsString()
  @MaxLength(1000)
  html_url: string;
}

/**
 * GitHub Pull Request branch ref (base/head)
 */
export class GitHubPullRequestRefDto {
  @IsString()
  @MaxLength(255)
  ref: string;

  @IsString()
  @MaxLength(100)
  sha: string;
}

/**
 * GitHub Pull Request object
 */
export class GitHubPullRequestDto {
  @IsNumber()
  id: number;

  @IsNumber()
  number: number;

  @IsString()
  @MaxLength(1000)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  body?: string;

  @IsString()
  @MaxLength(1000)
  html_url: string;

  @IsBoolean()
  draft: boolean;

  @IsString()
  @MaxLength(50)
  state: string;

  @ValidateNested()
  @Type(() => GitHubPullRequestRefDto)
  base: GitHubPullRequestRefDto;

  @ValidateNested()
  @Type(() => GitHubPullRequestRefDto)
  head: GitHubPullRequestRefDto;

  @ValidateNested()
  @Type(() => GitHubUserDto)
  user: GitHubUserDto;
}

/**
 * GitHub `pull_request` Webhook Event DTO
 * https://docs.github.com/en/webhooks/webhook-events-and-payloads#pull_request
 */
export class PullRequestEventDto {
  @IsString()
  @IsNotEmpty()
  action: string;

  @ValidateNested()
  @Type(() => GitHubPullRequestDto)
  pull_request: GitHubPullRequestDto;

  @ValidateNested()
  @Type(() => GitHubRepositoryDto)
  repository: GitHubRepositoryDto;
}
