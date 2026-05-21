-- Team video presenter fields for thank_you_clients

alter table public.thank_you_clients
  add column if not exists team_video_presenters text,
  add column if not exists team_video_placeholder_text text;

comment on column public.thank_you_clients.team_video_presenters is
  'Names shown in the team video section, e.g. "Carl & Toby". Leave null to hide the section.';

comment on column public.thank_you_clients.team_video_url is
  'Vimeo video ID. When null but presenters is set, shows the placeholder state.';

comment on column public.thank_you_clients.team_video_placeholder_text is
  'Subtext under presenter names when video is not ready. Defaults to "Message coming shortly".';
