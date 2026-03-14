
import { get, set, del, clear } from 'idb-keyval';

export const storage = {
  async getItem<T>(key: string): Promise<T | null> {
    try {
      return await get(key) || null;
    } catch (e) {
      console.error(`Error getting item ${key} from IndexedDB`, e);
      return null;
    }
  },

  async setItem(key: string, value: any): Promise<void> {
    try {
      await set(key, value);
    } catch (e) {
      console.error(`Error setting item ${key} in IndexedDB`, e);
      throw e;
    }
  },

  async removeItem(key: string): Promise<void> {
    try {
      await del(key);
    } catch (e) {
      console.error(`Error removing item ${key} from IndexedDB`, e);
    }
  },

  async clearAll(): Promise<void> {
    try {
      await clear();
    } catch (e) {
      console.error('Error clearing IndexedDB', e);
    }
  }
};
