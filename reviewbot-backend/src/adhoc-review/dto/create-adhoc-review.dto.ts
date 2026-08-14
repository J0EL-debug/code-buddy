import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength, IsIn, IsOptional } from 'class-validator';

/**
 * DTO for reviewing pasted code (JSON body path - file uploads use multipart
 * and are parsed separately in the controller)
 */
export class CreateAdhocReviewDto {
  @ApiProperty({ example: 'example.js', description: 'File name (used to detect language)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fileName: string;

  @ApiProperty({ example: 'function add(a, b) { return a + b; }', description: 'Full source code to review' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200000)
  code: string;

  @ApiProperty({
    example: 'review',
    description: '"review" just finds issues; "fix" also has the AI rewrite the code',
    enum: ['review', 'fix'],
    required: false,
  })
  @IsIn(['review', 'fix'])
  @IsOptional()
  mode?: 'review' | 'fix';
}
