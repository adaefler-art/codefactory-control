/**
 * Unit tests for runbook loader
 * I905 - Runbooks UX
 * 
 * @jest-environment node
 */

import { loadAllRunbooks, getRunbookMetadata } from '../loader';

describe('Runbook Loader', () => {
  describe('loadAllRunbooks', () => {
    it('should return runbooks in deterministic lexicographic order', () => {
      const runbooks = loadAllRunbooks();
      
      // Verify we have some runbooks
      expect(runbooks.length).toBeGreaterThan(0);
      
      // Verify deterministic ordering (sorted by filename)
      const filePaths = runbooks.map(r => r.filePath);
      const sortedPaths = [...filePaths].sort();
      
      expect(filePaths).toEqual(sortedPaths);
    });
    
    it('should extract title from markdown heading', () => {
      const runbooks = loadAllRunbooks();
      
      // All runbooks should have titles
      runbooks.forEach(runbook => {
        expect(runbook.title).toBeDefined();
        expect(runbook.title.length).toBeGreaterThan(0);
      });
    });
    
    it('should generate unique slugs for each runbook', () => {
      const runbooks = loadAllRunbooks();
      const slugs = runbooks.map(r => r.slug);
      const uniqueSlugs = new Set(slugs);
      
      expect(uniqueSlugs.size).toBe(slugs.length);
    });
    
    it('should assign at least one tag to each runbook', () => {
      const runbooks = loadAllRunbooks();
      
      runbooks.forEach(runbook => {
        expect(runbook.tags).toBeDefined();
        expect(runbook.tags.length).toBeGreaterThan(0);
      });
    });
    
    it('should include content for each runbook', () => {
      const runbooks = loadAllRunbooks();
      
      runbooks.forEach(runbook => {
        expect(runbook.content).toBeDefined();
        expect(runbook.content.length).toBeGreaterThan(0);
      });
    });
  });
  
  describe('getRunbookMetadata', () => {
    it('should return metadata without content', () => {
      const metadata = getRunbookMetadata();
      
      expect(metadata.length).toBeGreaterThan(0);
      
      metadata.forEach(meta => {
        expect(meta.id).toBeDefined();
        expect(meta.slug).toBeDefined();
        expect(meta.title).toBeDefined();
        expect(meta.tags).toBeDefined();
        expect(meta.filePath).toBeDefined();
        // Content should not be present
        expect((meta as any).content).toBeUndefined();
      });
    });
    
    it('should maintain deterministic ordering', () => {
      const metadata1 = getRunbookMetadata();
      const metadata2 = getRunbookMetadata();
      
      expect(metadata1.map(m => m.id)).toEqual(metadata2.map(m => m.id));
    });
  });
  
  describe('Tag Inference', () => {
    it('should tag migration-related runbooks with "migrations" tag', () => {
      const runbooks = loadAllRunbooks();
      const migrationRunbook = runbooks.find(r => 
        r.filePath.toLowerCase().includes('migration') ||
        r.filePath.toLowerCase().includes('parity')
      );
      
      if (migrationRunbook) {
        expect(migrationRunbook.tags).toContain('migrations');
      }
    });
    
    it('should tag smoke test runbooks with "smoke" tag', () => {
      const runbooks = loadAllRunbooks();
      const smokeRunbook = runbooks.find(r => 
        r.filePath.toLowerCase().includes('smoke')
      );
      
      if (smokeRunbook) {
        expect(smokeRunbook.tags).toContain('smoke');
      }
    });
    
    it('should tag deploy-related runbooks with "deploy" tag', () => {
      const runbooks = loadAllRunbooks();
      const deployRunbook = runbooks.find(r => 
        r.filePath.toLowerCase().includes('deploy')
      );
      
      if (deployRunbook) {
        expect(deployRunbook.tags).toContain('deploy');
      }
    });
  });
});
