import { useCallback } from 'react';
import { Button, FileTrigger } from 'react-aria-components';

import * as styles from './styles.css';

type Props = { readonly onFiles: (files: readonly File[]) => void };

export const UploadPicker = ({ onFiles }: Props) => {
  const handleSelect = useCallback(
    (files: FileList | null) => {
      if (files === null) return;
      onFiles(Array.from(files));
    },
    [onFiles],
  );

  return (
    <FileTrigger allowsMultiple onSelect={handleSelect}>
      <Button className={styles.button}>ファイルを追加</Button>
    </FileTrigger>
  );
};
