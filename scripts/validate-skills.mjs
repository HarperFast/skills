import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const SKILL_FILE = 'SKILL.md';
const AGENTS_FILE = 'AGENTS.md';

function getAllFiles(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach((file) => {
    if (file === 'node_modules' || file === '.git') return;
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath));
    } else if (file.endsWith('.md')) {
      results.push(filePath);
    }
  });
  return results;
}

function validateSkillFile(filePath, data) {
  const errors = [];

  if (!data.name) {
    errors.push('Missing "name" in frontmatter');
  } else if (typeof data.name !== 'string') {
    errors.push('"name" must be a string');
  } else if (!/^[a-z0-9-]+$/.test(data.name)) {
    errors.push('"name" must be lowercase and only contain letters, numbers, and hyphens');
  }

  if (!data.description) {
    errors.push('Missing "description" in frontmatter');
  } else if (typeof data.description !== 'string') {
    errors.push('"description" must be a string');
  }

  if (data.metadata) {
    if (typeof data.metadata !== 'object') {
      errors.push('"metadata" must be an object');
    } else {
      if (data.metadata.version && typeof data.metadata.version !== 'string') {
        errors.push('"metadata.version" must be a string');
      }
      if (data.metadata.internal !== undefined && typeof data.metadata.internal !== 'boolean') {
        errors.push('"metadata.internal" must be a boolean');
      }
    }
  }

  return errors;
}

function validateRuleFile(filePath, data) {
  const errors = [];

  if (!data.name) {
    errors.push('Missing "name" in frontmatter');
  } else if (typeof data.name !== 'string') {
    errors.push('"name" must be a string');
  }

  if (!data.description) {
    errors.push('Missing "description" in frontmatter');
  } else if (typeof data.description !== 'string') {
    errors.push('"description" must be a string');
  }

  return errors;
}

function validateAgentsFile(filePath, content) {
  const errors = [];
  if (!content.trim().startsWith('# ')) {
    errors.push('Should start with a top-level heading (H1)');
  }
  return errors;
}

const allFiles = getAllFiles('.');
let hasError = false;

allFiles.forEach((file) => {
  const content = fs.readFileSync(file, 'utf8');
  let errors = [];

  if (file.endsWith(SKILL_FILE)) {
    const { data, content: body } = matter(content);
    errors = validateSkillFile(file, data);
    if (!body.includes('## When to Use')) {
      errors.push('Missing "## When to Use" section');
    }
    if (!body.includes('## Steps')) {
      errors.push('Missing "## Steps" section');
    }
  } else if (file.includes(path.sep + 'rules' + path.sep)) {
    const { data, content: body } = matter(content);
    errors = validateRuleFile(file, data);
    if (!body.trim().startsWith('# ')) {
      errors.push('Rule file should start with a top-level heading (H1)');
    }
  } else if (file.endsWith(AGENTS_FILE)) {
    errors = validateAgentsFile(file, content);
  } else {
    // Other markdown files (like README.md) - no specific validation for now
    return;
  }

  if (errors.length > 0) {
    console.error(`Validation failed for ${file}:`);
    errors.forEach((err) => console.error(`  - ${err}`));
    hasError = true;
  } else {
    // console.log(`✓ ${file} is valid`);
  }
});

if (hasError) {
  process.exit(1);
} else {
  console.log('✓ All skills and rules validated successfully');
}
