// The registry is the single honest map between runtime configuration and its
// Settings home.  It deliberately records legacy keys too, so an old control
// cannot be mistaken for a working feature.
const SETTINGS = [
  { key: 'scene_state_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Scene-state extraction' },
  { key: 'scene_state_model', status: 'active', uiOwner: 'story-dynamics', label: 'Scene-state model' },
  { key: 'scene_state_keep_alive', status: 'active', uiOwner: 'story-dynamics', label: 'Scene-state model residency' },
  { key: 'image_warmup_enabled', status: 'active', uiOwner: 'image-generation', label: 'Image service preload' },
  { key: 'a1111_url', status: 'active', uiOwner: 'image-generation', label: 'A1111 URL' },
  { key: 'a1111_faceid_model', status: 'active', uiOwner: 'image-generation', label: 'FaceID model' },
  { key: 'a1111_faceid_module', status: 'active', uiOwner: 'image-generation', label: 'FaceID module' },
  { key: 'a1111_faceid_weight', status: 'active', uiOwner: 'image-generation', label: 'FaceID weight' },
  { key: 'a1111_pose_model', status: 'active', uiOwner: 'image-generation', label: 'Pose model' },
  { key: 'a1111_pose_module', status: 'active', uiOwner: 'image-generation', label: 'Pose module' },
  { key: 'a1111_pose_weight', status: 'active', uiOwner: 'image-generation', label: 'Pose weight' },
  { key: 'master_negative', status: 'active', uiOwner: 'image-generation', label: 'Master image negative' },
  { key: 'nsfw_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'NSFW enabled' },
  { key: 'explicit_mode', status: 'active', uiOwner: 'story-dynamics', label: 'Explicit mode' },
  { key: 'arousal_decay_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Arousal decay' },
  { key: 'emotion_tracking_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Emotion tracking' },
  { key: 'relationship_deltas_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Relationship deltas' },
  { key: 'mood_gate_toasts_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Mood gate toasts' },
  { key: 'regen_state_snapshot_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Regeneration state snapshot' },
  { key: 'cast_trigger_chips_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Cast trigger chips' },
  { key: 'scene_heat_readout_enabled', status: 'active', uiOwner: 'story-dynamics', label: 'Scene heat readout' },
  { key: 'sfw_arousal_ceiling', status: 'active', uiOwner: 'story-dynamics', label: 'SFW arousal ceiling' },
  { key: 'llamacpp_config.narrator', status: 'active', uiOwner: 'models', label: 'Narrator backend' },
  { key: 'narrator_max_tokens', status: 'active', uiOwner: 'models', label: 'Narrator output tokens' },
  { key: 'narrator_context_tokens', status: 'active', uiOwner: 'models', label: 'Narrator input context tokens' },
  { key: 'llamacpp_config.extractor', status: 'legacy', reason: 'This saved role is not read by scene-state extraction. Scene-state uses scene_state_model instead.' },
];

export function getSettingsRegistry() {
  return SETTINGS.map((setting) => ({ ...setting }));
}

export function getVisibleSettings() {
  return getSettingsRegistry().filter((setting) => setting.status === 'active' && setting.uiOwner);
}
