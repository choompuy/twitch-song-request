function row({ index, thumbnail, title, subtitle, meta = '', extra = '', actions = '', className = '', attributes = '' }) {
  return `
    <div class="row-item ${className}" ${attributes}>
      ${index != null ? `<span class="row-index text-sm text-secondary text-bold">${index + 1}</span>` : ''}
      ${thumbnail ? `<img src="${escapeHtml(thumbnail)}" class="thumbnail" alt="${escapeHtml(title)}">` : ''}
      <div class="row-info">
        <div class="text-sm text-primary truncate">${escapeHtml(title)}</div>
        ${subtitle ? `<div class="text-xs text-secondary truncate">${escapeHtml(subtitle)}</div>` : ''}
      </div>
      ${extra}
      ${meta ? `<span class="text-sm text-secondary">${meta}</span>` : ''}
      ${actions ? `<div class="row-ctrl">${actions}</div>` : ''}
    </div>
  `
}

function createViews(dom) {
  const search = createListView(dom.searchListWrapper, {
    cache: false,
    renderRow: (song) =>
      row({
        thumbnail: song.thumbnail,
        title: song.title,
        subtitle: song.channelTitle,
        meta: formatDuration(song.duration),
        actions: `
          <button
            class="btn btn-sm btn-icon"
            data-action="search-add"
            data-video-id="${escapeHtml(song.videoId)}"
            title="Add to queue"
          >
            ${PLUS_ICON()}
          </button>
        `
      })
  })

  const queue = createListView(dom.queueListWrapper, {
    getKey: (items) => items.map((item) => [item.videoId, item.requestedBy, item.title, item.thumbnail, item.duration].join(':')).join('|'),
    renderRow: (item, index) =>
      row({
        index,
        thumbnail: item.thumbnail,
        title: item.title,
        subtitle: item.channelTitle,
        extra: `
          <span class="text-sm text-green">
            @${escapeHtml(item.requestedBy)}
          </span>
        `,
        meta: formatDuration(item.duration),
        actions: `
          <button
            class="btn btn-sm btn-icon"
            data-action="queue-remove"
            data-index="${index}"
            title="Remove from queue"
          >
            ${DELETE_ICON()}
          </button>
        `,
        attributes: `data-queue-index="${index}"`
      })
  })

  const fallback = createListView(dom.fallbackListWrapper, {
    getKey: (items) => items.map((item) => `${item.videoId}:${item.isPlayed}`).join('|'),
    renderRow: (track) => {
      const item = dom.fallbackListWrapper.querySelector('.row-list')
      const isActive = track.videoId === item.dataset.activeVideoId
      const rowClass = isActive ? 'row-active' : track.isPlayed ? 'row-played' : ''

      return row({
        className: rowClass,
        attributes: `data-video-id="${escapeHtml(track.videoId)}"`,
        thumbnail: track.thumbnail,
        title: track.title,
        subtitle: track.channelTitle,
        meta: formatDuration(track.duration),
        actions: `
          <button
            class="btn btn-sm btn-icon"
            data-action="fallback-enqueue"
            data-video-id="${escapeHtml(track.videoId)}"
            title="Add to queue"
          >
            ${PLUS_ICON()}
          </button>

          <button
            class="btn btn-sm btn-icon"
            data-action="fallback-play"
            data-video-id="${escapeHtml(track.videoId)}"
            title="Play now"
          >
            ${PLAY_ICON()}
          </button>
        `
      })
    }
  })

  const activity = createListView(dom.activityListWrapper, {
    getKey: (items) => {
      const minute = Math.floor(Date.now() / 60000)
      return [minute, ...items.map((entry) => [entry.at, entry.status, entry.title, entry.query, entry.requestedBy, entry.reason].join(':'))].join(
        '|'
      )
    },
    renderRow: (entry) => {
      const title = entry.title || entry.query
      return row({
        title,
        subtitle: entry.reason || '',
        extra: `
          <div class="text-sm text-secondary">
            ${formatRelativeTime(entry.at)}
          </div>
          <div class="text-sm text-green">
            @${escapeHtml(entry.requestedBy)}
          </div>
          <span class="text-xs text-bold status-pill ${escapeHtml(entry.status)}">
            ${escapeHtml(entry.status)}
          </span>
        `
      })
    }
  })

  const playlists = createListView(dom.playlistsListWrapper, {
    getKey: (items) => {
      const activeId = dom.playlistsListWrapper.dataset.activeId || ''
      return [activeId, ...items.map((playlist) => [playlist.id, playlist.title, playlist.thumbnail, playlist.itemCount].join(':'))].join('|')
    },

    renderRow: (playlist) => {
      const activeId = dom.playlistsListWrapper.dataset.activeId
      const isActive = playlist.id === activeId

      return row({
        className: isActive ? 'row-active' : '',
        thumbnail: playlist.thumbnail,
        title: playlist.title,
        subtitle: `${playlist.itemCount} tracks`,
        actions: `
          <button
            class="btn btn-sm btn-icon btn-secondary ${isActive ? 'active' : ''}"
            data-action="playlist-activate"
            data-id="${escapeHtml(playlist.id)}"
            title="${isActive ? 'Pause playlist' : 'Play playlist'}"
          >
            ${isActive ? PAUSE_ICON() : PLAY_ICON()}
          </button>
          <button
            class="btn btn-sm btn-icon btn-secondary btn-danger"
            data-action="playlist-delete"
            data-id="${escapeHtml(playlist.id)}"
            title="Delete playlist"
          >
            ${DELETE_ICON()}
          </button>
        `
      })
    }
  })

  return {
    queue,
    fallback,
    search,
    activity,
    playlists
  }
}
