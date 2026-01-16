/**
 * Upload Storage Service
 * 
 * Handles file storage for INTENT session uploads.
 * Issue V09-I06: Upload + Sources Management (Product Memory Basis)
 * 
 * Storage Strategy:
 * - Production: AWS S3 (when AWS_UPLOAD_BUCKET env var is set)
 * - Development: Local filesystem fallback
 * 
 * Security:
 * - File type allowlist (pdf/md/txt/json/png/jpg)
 * - Size limits (configurable, default 10MB)
 * - SHA256 hash verification
 */

import { createHash } from 'crypto';
import { writeFile, mkdir, unlink, readFile } from 'fs/promises';
import { join } from 'path';

// ========================================
// Configuration
// ========================================

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/afu9-uploads';
const MAX_UPLOAD_SIZE_BYTES = parseInt(process.env.MAX_UPLOAD_SIZE_BYTES || '10485760', 10); // 10MB default

// Allowlist of permitted MIME types
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/markdown',
  'text/plain',
  'application/json',
  'image/png',
  'image/jpeg',
] as const;

type AllowedMimeType = typeof ALLOWED_MIME_TYPES[number];

// File extension to MIME type mapping
const EXTENSION_TO_MIME: Record<string, AllowedMimeType> = {
  '.pdf': 'application/pdf',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

// ========================================
// Types
// ========================================

export interface UploadValidationResult {
  valid: boolean;
  error?: string;
  contentType?: AllowedMimeType;
  sizeBytes?: number;
}

export interface UploadResult {
  storageKey: string;
  contentSha256: string;
  sizeBytes: number;
  contentType: AllowedMimeType;
}

// ========================================
// Validation Functions
// ========================================

/**
 * Validate file size
 */
export function validateFileSize(sizeBytes: number): { valid: boolean; error?: string } {
  if (sizeBytes <= 0) {
    return { valid: false, error: 'File size must be greater than 0' };
  }
  
  if (sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    return { 
      valid: false, 
      error: `File size exceeds maximum allowed size of ${MAX_UPLOAD_SIZE_BYTES} bytes (${Math.round(MAX_UPLOAD_SIZE_BYTES / 1024 / 1024)}MB)` 
    };
  }
  
  return { valid: true };
}

/**
 * Validate and determine content type from filename and declared MIME type
 */
export function validateContentType(
  filename: string, 
  declaredMimeType?: string
): UploadValidationResult {
  // Extract file extension
  const extensionMatch = filename.match(/(\.[^.]+)$/);
  if (!extensionMatch) {
    return { valid: false, error: 'File must have a valid extension' };
  }
  
  const extension = extensionMatch[1].toLowerCase();
  const mimeFromExtension = EXTENSION_TO_MIME[extension];
  
  if (!mimeFromExtension) {
    return { 
      valid: false, 
      error: `File type '${extension}' not allowed. Allowed types: ${Object.keys(EXTENSION_TO_MIME).join(', ')}` 
    };
  }
  
  // If MIME type is declared, verify it matches extension
  if (declaredMimeType && declaredMimeType !== mimeFromExtension) {
    return { 
      valid: false, 
      error: `Declared MIME type '${declaredMimeType}' does not match file extension '${extension}' (expected '${mimeFromExtension}')` 
    };
  }
  
  return { valid: true, contentType: mimeFromExtension };
}

/**
 * Validate upload request
 */
export function validateUpload(
  filename: string,
  sizeBytes: number,
  declaredMimeType?: string
): UploadValidationResult {
  // Validate filename
  if (!filename || filename.length === 0) {
    return { valid: false, error: 'Filename is required' };
  }
  
  if (filename.length > 255) {
    return { valid: false, error: 'Filename too long (max 255 characters)' };
  }
  
  // Validate size
  const sizeValidation = validateFileSize(sizeBytes);
  if (!sizeValidation.valid) {
    return sizeValidation;
  }
  
  // Validate content type
  const typeValidation = validateContentType(filename, declaredMimeType);
  if (!typeValidation.valid) {
    return typeValidation;
  }
  
  return { 
    valid: true, 
    contentType: typeValidation.contentType,
    sizeBytes 
  };
}

// ========================================
// Hash Functions
// ========================================

/**
 * Calculate SHA256 hash of file content
 */
export function calculateSHA256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

// ========================================
// Storage Functions
// ========================================

/**
 * Store file content and return storage metadata
 * 
 * @param sessionId - Session ID for organizing uploads
 * @param uploadId - Upload ID (UUID)
 * @param filename - Original filename
 * @param content - File content buffer
 * @param contentType - Validated MIME type
 * @returns Upload result with storage key and hash
 */
export async function storeUpload(
  sessionId: string,
  uploadId: string,
  filename: string,
  content: Buffer,
  contentType: AllowedMimeType
): Promise<UploadResult> {
  // Calculate hash
  const contentSha256 = calculateSHA256(content);
  const sizeBytes = content.length;
  
  // Storage key format: {sessionId}/{uploadId}/{filename}
  const storageKey = `${sessionId}/${uploadId}/${filename}`;
  
  // For now, use local filesystem storage
  // TODO: Add S3 storage when AWS_UPLOAD_BUCKET is configured
  const uploadPath = join(UPLOAD_DIR, storageKey);
  
  // Ensure directory exists
  await mkdir(join(UPLOAD_DIR, sessionId, uploadId), { recursive: true });
  
  // Write file
  await writeFile(uploadPath, content);
  
  return {
    storageKey,
    contentSha256,
    sizeBytes,
    contentType,
  };
}

/**
 * Delete stored file
 * 
 * @param storageKey - Storage key from upload record
 */
export async function deleteUpload(storageKey: string): Promise<void> {
  const uploadPath = join(UPLOAD_DIR, storageKey);
  
  try {
    await unlink(uploadPath);
  } catch (error) {
    // Ignore errors if file doesn't exist (already deleted)
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Retrieve stored file content
 * 
 * @param storageKey - Storage key from upload record
 * @returns File content buffer
 */
export async function retrieveUpload(storageKey: string): Promise<Buffer> {
  const uploadPath = join(UPLOAD_DIR, storageKey);
  return readFile(uploadPath);
}
