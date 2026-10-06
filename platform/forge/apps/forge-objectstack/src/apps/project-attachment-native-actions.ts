import { AppPlugin } from '@objectstack/runtime';
import { defineStack, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { ProjectAttachmentCreate } from '../actions/project-attachment.action.js';

/**
 * The Action binds to the host-owned forge_project record. This addon owns
 * only its Action metadata; schemas, permission sets and native record loading
 * remain owned by Forge/ObjectStack.
 */
export const projectAttachmentNativeActions = [ProjectAttachmentCreate] as const;

const normalizedProjectAttachmentActionBundle = defineStack({
  manifest: {
    id: 'com.inoforge.forge.project-attachment-actions',
    namespace: 'forge_project_att',
    version: '0.1.0',
    type: 'plugin',
    name: 'Forge Project Attachment Actions',
    engines: { protocol: '>=17.3.0 <18' },
  },
  actions: [...projectAttachmentNativeActions],
}, { strict: false });

export const projectAttachmentNativeActionsBundle =
  ObjectStackDefinitionSchema.parse(normalizedProjectAttachmentActionBundle);
export const projectAttachmentNativeActionsPlugin =
  new AppPlugin(projectAttachmentNativeActionsBundle);
