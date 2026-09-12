const DELETE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m18 6-.8 12.013c-.071 1.052-.106 1.578-.333 1.977a2 2 0 0 1-.866.81c-.413.2-.94.2-1.995.2H9.994c-1.055 0-1.582 0-1.995-.2a2 2 0 0 1-.866-.81c-.227-.399-.262-.925-.332-1.977L6 6M4 6h16m-4 0-.27-.812c-.263-.787-.394-1.18-.637-1.471a2 2 0 0 0-.803-.578C13.939 3 13.524 3 12.695 3h-1.388c-.829 0-1.244 0-1.596.139a2 2 0 0 0-.803.578c-.243.29-.374.684-.636 1.471L8 6m6 4v7m-4-7v7"/>
  </svg>
`

const PLUS_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24">
    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 12h12m-6-6v12"/>
  </svg>
`

const PLAY_ICON = (size) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="${size || 24}" height="${size || 24}" fill="none" viewBox="0 0 24 24">
    <path
      stroke="currentColor"
      stroke-linejoin="round"
      stroke-width="2"
      d="M16.658 9.286c1.44.9 2.16 1.35 2.407 1.926a2 2 0 0 1 0 1.576c-.247.576-.967 1.026-2.407 1.926L9.896 18.94c-1.598.999-2.397 1.498-3.056 1.445a2 2 0 0 1-1.446-.801C5 19.053 5 18.111 5 16.226V7.774c0-1.885 0-2.827.394-3.358a2 2 0 0 1 1.446-.801c.66-.053 1.458.446 3.056 1.445z"
    />
  </svg>
`

const PAUSE_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5v14m8-14v14" />
  </svg>
`

const CHECK_ICON = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none">
    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m5 13 4 4L19 7"/>
  </svg>
`

const EMPTY = (text) => `
  <div>
    <div class="empty">${text}</div>
  </div>
`
