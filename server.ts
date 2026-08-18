// ============================================
// 星河之旅 · 七夕特典 — PartyKit Server
// 功能：房间管理、消息广播、数据持久化（KV）
// ============================================

export default {
  async onConnect(connection, ctx) {
    const roomId = ctx.room.id;

    // 连接加入房间
    await connection.send(JSON.stringify({
      type: 'sys',
      action: 'joined',
      roomId: roomId,
      onlineCount: ctx.room.connections.size
    }));

    // 广播有人加入
    for (const conn of ctx.room.connections) {
      if (conn.id !== connection.id) {
        await conn.send(JSON.stringify({
          type: 'sys',
          action: 'user_join',
          onlineCount: ctx.room.connections.size
        }));
      }
    }

    // 监听消息
    connection.addEventListener('message', async (e) => {
      try {
        const data = JSON.parse(e.data);
        // 广播给房间内所有人（含发送者）
        for (const conn of ctx.room.connections) {
          await conn.send(JSON.stringify(data));
        }

        // 数据持久化：存到 PartyKit KV
        if (data.type === 'persist') {
          const key = `room:${roomId}:${data.store}`;
          await ctx.room.storage.setItem(key, data.value);
        }

        // 读取持久化数据
        if (data.type === 'load') {
          const key = `room:${roomId}:${data.store}`;
          const value = await ctx.room.storage.getItem(key);
          await connection.send(JSON.stringify({
            type: 'load_result',
            store: data.store,
            value: value
          }));
        }
      } catch (err) {
        // 忽略解析错误
      }
    });

    // 断开连接
    connection.addEventListener('close', async () => {
      for (const conn of ctx.room.connections) {
        try {
          await conn.send(JSON.stringify({
            type: 'sys',
            action: 'user_leave',
            onlineCount: ctx.room.connections.size
          }));
        } catch {}
      }
    });
  }
};
