import { describe, expect, it } from 'vitest';
import { sshAliasFor } from '../src/ssh-config.ts';

const CONFIG = `# a laptop
Host *
  ServerAliveInterval 30

Host my-desktop pc
  HostName 100.64.0.1
  User alice
  IdentityFile ~/.ssh/my-desktop

Host work-*
  HostName 10.0.0.5

Match host 10.0.0.9
  HostName 10.0.0.9

Host nas
  HostName=NAS.local
  HostName 192.168.1.2
`;

describe('sshAliasFor', () => {
  it('finds the first alias of a block whose HostName is the address', () => {
    expect(sshAliasFor('100.64.0.1', CONFIG)).toBe('my-desktop');
    expect(sshAliasFor(' 100.64.0.1 ', CONFIG)).toBe('my-desktop');
  });

  it('compares host names without case and keeps the first HostName of a block', () => {
    expect(sshAliasFor('nas.local', CONFIG)).toBe('nas');
    expect(sshAliasFor('192.168.1.2', CONFIG)).toBeNull();
  });

  it('ignores patterns and Match blocks', () => {
    expect(sshAliasFor('10.0.0.5', CONFIG)).toBeNull();
    expect(sshAliasFor('10.0.0.9', CONFIG)).toBeNull();
  });

  it('gives nothing for an alias typed as such or an unknown address', () => {
    expect(sshAliasFor('my-desktop', CONFIG)).toBeNull();
    expect(sshAliasFor('PC', CONFIG)).toBeNull();
    expect(sshAliasFor('100.1.1.1', CONFIG)).toBeNull();
    expect(sshAliasFor('', CONFIG)).toBeNull();
    expect(sshAliasFor('100.64.0.1', '')).toBeNull();
  });
});
