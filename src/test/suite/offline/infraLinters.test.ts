/**
 * test/suite/offline/infraLinters.test.ts — Unit tests for offline Terraform & Dockerfile linters
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { InfraLinters } from '../../../offline/infraLinters';

suite('Offline Infrastructure & Security Linters Suite', () => {
  test('flags wide-open 0.0.0.0/0 ingress in Terraform files', () => {
    const tfCode = `
resource "aws_security_group" "allow_all" {
  name        = "allow_all"
  description = "Allow all inbound traffic"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
`;

    const mockDoc = {
      getText: () => tfCode,
      fileName: 'main.tf',
      languageId: 'terraform',
      uri: vscode.Uri.file('/path/to/main.tf'),
    } as unknown as vscode.TextDocument;

    const issues = InfraLinters.lintTerraform(mockDoc);
    assert.ok(issues.some(i => i.ruleId === 'TF-SEC-01'));
  });

  test('flags unencrypted S3 storage bucket in Terraform', () => {
    const tfCode = `
resource "aws_s3_bucket" "unencrypted_bucket" {
  bucket = "my-sensitive-data-bucket"
}
`;

    const mockDoc = {
      getText: () => tfCode,
      fileName: 'storage.tf',
      languageId: 'terraform',
      uri: vscode.Uri.file('/path/to/storage.tf'),
    } as unknown as vscode.TextDocument;

    const issues = InfraLinters.lintTerraform(mockDoc);
    assert.ok(issues.some(i => i.ruleId === 'TF-SEC-02'));
  });

  test('flags unpinned base image and missing root user in Dockerfile', () => {
    const dockerfile = `
FROM python:latest

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
RUN pip install extra-tool
RUN pip install another-tool
COPY . .
CMD ["python", "app.py"]
`;

    const mockDoc = {
      getText: () => dockerfile,
      fileName: 'Dockerfile',
      languageId: 'dockerfile',
      uri: vscode.Uri.file('/path/to/Dockerfile'),
    } as unknown as vscode.TextDocument;

    const issues = InfraLinters.lintDockerfile(mockDoc);
    assert.ok(issues.some(i => i.ruleId === 'DOCKER-01')); // latest tag
    assert.ok(issues.some(i => i.ruleId === 'DOCKER-02')); // missing USER instruction
    assert.ok(issues.some(i => i.ruleId === 'DOCKER-05')); // consecutive RUN commands
  });

  test('flags insecure curl | bash in Dockerfile', () => {
    const dockerfile = `
FROM python:3.11-slim
RUN curl -sSL https://install.python-poetry.org | bash
USER appuser
CMD ["python", "app.py"]
`;

    const mockDoc = {
      getText: () => dockerfile,
      fileName: 'Dockerfile',
      languageId: 'dockerfile',
      uri: vscode.Uri.file('/path/to/Dockerfile'),
    } as unknown as vscode.TextDocument;

    const issues = InfraLinters.lintDockerfile(mockDoc);
    assert.ok(issues.some(i => i.ruleId === 'DOCKER-04'));
  });
});
